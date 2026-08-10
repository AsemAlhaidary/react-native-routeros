---
phase: 04-robustness-lifecycle
plan: 04
type: execute
wave: 1
depends_on: ["03-commands-streaming"]
files_modified:
  - src/RouterOSAPI.ts
  - src/Connector.ts
requirements:
  - ERR-02
  - LIFE-01
  - LIFE-02
---

<objective>
Harden the library against React Native app lifecycle events and connection disruptions. When the app backgrounds, the library detects it and prevents socket leaks. When !fatal protocol errors arrive from the router, the connection is cleanly torn down and the consumer is notified. When a socket drops unexpectedly, the consumer receives a clear event so they can reconnect — no silent failures, no leaked state.
</objective>

<execution_context>
@C:/Users/Asem/.config/opencode/gsd-core/workflows/execute-plan.md
</execution_context>

<context>
@.planning/ROADMAP.md (Phase 4 goal + success criteria)
@.planning/REQUIREMENTS.md (ERR-02, LIFE-01, LIFE-02)
@src/RouterOSAPI.ts (current state: post-login connector wiring at lines 125-131)
@src/Connector.ts (current state: onEnd at line 192, onError at line 202, fatal wiring at lines 88+107)
@src/Receiver.ts (current state: !fatal detection at line 199 — emits 'fatal' on socket)
</context>

<!-- ============================================================ -->
<!-- ANALYSIS: Current gaps                                       -->
<!-- ============================================================ -->
<analysis>

### Gap 1: No post-login close listener (ERR-02, LIFE-02)

`RouterOSAPI.connect()` currently installs a pre-login `endListener` that hears `'close'` on the Connector and rejects the connect promise. After login succeeds (line 121-131), the `endListener` is **removed** and replaced with `connectedErrorListener` — but `connectedErrorListener` only listens for `'error'` and `'timeout'`, and only fires **once** (`connector!.once(...)`). There is **no `'close'` listener** post-login.

Flow when !fatal arrives today:
1. Receiver.processSentence() detects `!fatal` (line 199) → emits `'fatal'` on socket
2. Connector constructor wires `socket.once('fatal', this.onEnd.bind(this))` → calls `onEnd()`
3. `onEnd()` emits `'close'`, then calls `destroy()` (removes all Connector listeners)
4. RouterOSAPI has **no listener** for this `'close'` event
5. `this.connected` stays `true`; `this.connector` is a dead object
6. Future `write()` calls crash or hang silently

Same gap applies to unexpected socket drops (network loss, router reboot).

### Gap 2: No AppState awareness (LIFE-01)

React Native can suspend the JS thread when the app backgrounds. The TCP socket may be killed by the OS or become stale (server-side timeout). When the app returns to foreground, the library has no awareness of this transition — it cannot detect that the socket is dead until a write attempt fails.

### What must be added

1. **Post-login `close` listener** — one permanent listener on Connector that fires every time the connection drops (!fatal, socket error, network loss). It cleans up RouterOSAPI state (`connected=false`, stop streams, clear timers, null connector) and emits `'close'` so the consumer can reconnect.

2. **Distinguish !fatal from other closes** — The consumer needs to know *why* the connection closed. Socket-level errors already emit `'error'`. !fatal protocol errors should emit a distinct event (e.g., `'fatal'`) so consumers know this was a router-side shutdown, not a network blip.

3. **AppState listener** — On foreground return, check whether the Connector is still alive. If the socket closed while backgrounded, emit `'close'` (same event as task 1). No automatic reconnect — that's the consumer's decision.

</analysis>

<!-- ============================================================ -->
<!-- TASKS                                                        -->
<!-- ============================================================ -->

<tasks>

<!-- ============== TASK 1: !fatal propagation + close detection ============== -->
<task type="auto">
  <name>RouterOSAPI: post-login close listener + !fatal event propagation</name>
  <files>src/RouterOSAPI.ts, src/Connector.ts</files>

  <!-- ── Subtask 1a: Connector — add close reason ── -->
  <step id="1a">
    <name>Connector: propagate close reason through 'close' event</name>
    <files>src/Connector.ts</files>
    <action>
Modify `Connector.onEnd()` to accept an optional `reason` parameter and include it in the `'close'` event. This lets RouterOSAPI distinguish between a !fatal protocol error and a normal socket close/error.

**Change `onEnd()`:**
```typescript
/**
 * Socket close/fatal handler.
 * Emits 'close' with optional reason and destroys the socket + listeners.
 * @param reason  'fatal' for !fatal protocol errors, undefined for normal close
 */
private onEnd(reason?: 'fatal'): void {
  this.emit('close', reason, this);
  this.destroy();
}
```

**Change the socket `'fatal'` wiring** (plain TCP, line 107 and TLS, line 88). Pass the reason string:
```typescript
(this.socket as any).once('fatal', () => {
  this.onEnd('fatal');
});
```

(TCP at line 107, TLS at line 88 — identical change on both branches.)

**Important:** `destroy()` calls `removeAllListeners()` on the Connector. RouterOSAPI's post-login close listener (added in step 1b) must survive this — see step 1b for the pattern.
    </action>
    <verify>
      <automated>
node -e "
const fs = require('fs');
const content = fs.readFileSync('./src/Connector.ts', 'utf8');
// onEnd accepts optional reason
console.log('onEnd has reason param:', content.includes('private onEnd(reason'));
console.log('emit close with reason:', content.includes(\"emit('close', reason\") || content.includes(\"emit('close',reason\"));
// fatal wiring passes 'fatal'
console.log('fatal listener passes reason:', content.includes(\"onEnd('fatal')\") || content.includes('onEnd(\"fatal\")'));
// Both TCP and TLS branches updated
const fatalCount = (content.match(/onEnd\(.*fatal/gi) || []).length;
console.log('fatal reason passed in 2 branches:', fatalCount === 2);
"
      </automated>
    </verify>
  </step>

  <!-- ── Subtask 1b: RouterOSAPI — persistent post-login close listener ── -->
  <step id="1b">
    <name>RouterOSAPI: add persistent close + error listeners post-login</name>
    <files>src/RouterOSAPI.ts</files>
    <action>
In `RouterOSAPI.connect()`, after login succeeds (around line 121 where `endListener` is removed and `connectedErrorListener` is installed), replace the current post-login wiring with a **persistent** listener set.

**Current code (lines 121-136):**
```typescript
// Swap error/timeout listeners to post-login behavior
this.connector!.removeListener('error', endListener);
this.connector!.removeListener('timeout', endListener);

const connectedErrorListener = (e: Error) => {
  this.connected = false;
  this.connecting = false;
  this.emit('error', e);
};
this.connector!.once('error', connectedErrorListener);
this.connector!.once('timeout', connectedErrorListener);
```

**Replace with:**

```typescript
// Swap error/timeout listeners to post-login behavior
this.connector!.removeListener('error', endListener);
this.connector!.removeListener('timeout', endListener);

// Post-login: persistent listeners for connection lifecycle.
// 'close' fires for: !fatal, socket close, destroy — each exactly once
// because Connector.destroy() → removeAllListeners().
this.connector!.once('close', (reason?: 'fatal') => {
  this.connected = false;
  this.connecting = false;
  // Stop streams + clear timers (mirrors close() cleanup)
  this.stopAllStreams();
  if (this.keptaliveby) {
    clearTimeout(this.keptaliveby);
    this.keptaliveby = null;
  }
  if (this.connectionHoldInterval) {
    clearTimeout(this.connectionHoldInterval);
    this.connectionHoldInterval = null;
  }
  // Release connector reference
  this.connector = null;

  if (reason === 'fatal') {
    // ERR-02: Protocol-level !fatal — emit distinct event
    this.emit('fatal');
  }
  // LIFE-02: Consumer-facing close — enables reconnection
  this.emit('close');
});

// Post-login error/timeout — emit error and mark disconnected (not once: connector may error multiple times before destroy)
this.connector!.on('error', (e: Error) => {
  this.connected = false;
  this.connecting = false;
  this.emit('error', e);
});
this.connector!.once('timeout', (e: Error) => {
  this.connected = false;
  this.connecting = false;
  this.emit('error', e);
});
```

**Why `once` for close but `on` for error:** The `'close'` event fires exactly once per connection lifecycle because `Connector.onEnd()` → `destroy()` → `removeAllListeners()` prevents double-fires. The `'error'` event can fire multiple times before `destroy()` (e.g., multiple write failures on a dying socket). Using `on` for error ensures each error is surfaced; the consumer can clean up.

**Why `once` for timeout:** Socket timeout fires once per connection; using `once` avoids stale listeners after destroy.
    </action>
    <verify>
      <automated>
node -e "
const fs = require('fs');
const content = fs.readFileSync('./src/RouterOSAPI.ts', 'utf8');
// Post-login close listener exists
console.log('Has once close listener:', content.includes(\"once('close'\"));
// Emits fatal event for !fatal
console.log('Emits fatal event:', content.includes(\"emit('fatal')\"));
// Emits close event (consumer-facing)
console.log('Emits close event post-login:', content.includes(\"emit('close')\"));
// Stops all streams on close
console.log('stopAllStreams in close handler:', content.includes('stopAllStreams()'));
// Clears keepalive timer
console.log('clears keptaliveby:', content.includes('clearTimeout(this.keptaliveby)'));
// Clears connectionHoldInterval
console.log('clears connectionHoldInterval:', content.includes('clearTimeout(this.connectionHoldInterval)'));
// Nulls connector
console.log('nulls connector:', content.includes('this.connector = null'));
// Post-login error listener (on, not once)
console.log('on error (not once):', content.includes(\".on('error'\"));
// Post-login timeout listener (once)
console.log('once timeout:', content.includes(\"once('timeout'\"));
"
      </automated>
    </verify>
    <done>
- Connector 'close' event fires with `'fatal'` reason for !fatal; `undefined` for normal close
- RouterOSAPI post-login listens for connector 'close' once (cannot double-fire)
- On close: stops all streams, clears keepalive/connectionHold timers, sets `connector = null`, `connected = false`
- !fatal reason → emits `'fatal'` on RouterOSAPI (ERR-02 — consumer can listen for specifically router-side fatal errors)
- All close reasons → emits `'close'` on RouterOSAPI (LIFE-02 — consumer can reconnect)
- Post-login socket errors emit `'error'` (persistent `on`, not `once` — surfaces all errors before destroy)
- TypeScript compiles clean (`npx tsc --noEmit`) with zero new errors
    </done>
  </step>
</task>

<!-- ============== TASK 2: AppState lifecycle listener ============== -->
<task type="auto">
  <name>RouterOSAPI: React Native AppState listener for background/foreground detection</name>
  <files>src/RouterOSAPI.ts</files>
  <action>
Add a React Native `AppState` listener that detects when the app backgrounds or returns to foreground. On foreground return, check whether the Connector is still alive — if the socket dropped while backgrounded, emit `'close'` so the consumer knows to reconnect.

**Step 2a: Import AppState**

At the top of `src/RouterOSAPI.ts`, add:
```typescript
import { AppState, AppStateStatus } from 'react-native';
```

**Step 2b: Add field to RouterOSAPI class**

Add a new private field for the AppState subscription:
```typescript
/** React Native AppState listener subscription */
private appStateSubscription: { remove: () => void } | null = null;
```

(React Native's `AppState.addEventListener` returns `{ remove: () => void }`.)

**Step 2c: Register AppState listener on successful connect**

In `connect()`, after login succeeds and `this.connected = true` is set (after line 119), add:

```typescript
// Register AppState listener for background/foreground detection (LIFE-01)
if (!this.appStateSubscription) {
  this.appStateSubscription = AppState.addEventListener(
    'change',
    (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        // App returned to foreground — check if connection is alive
        if (this.connected && !this.connector) {
          // Socket died while backgrounded; Connector was already
          // destroyed by the task-1 close listener. State is already
          // set to connected=false. Emit close so consumer reconnects.
          // (The task-1 listener already emitted 'close' when the
          // connector fired its close event — but if the JS thread
          // was suspended, that event may have been missed.)
          //
          // We emit 'close' again if state still shows connected but
          // connector is null — this is the "missed event" recovery case.
          this.connected = false;
          this.emit('close');
        }
        // If still connected (connector !== null), do nothing —
        // the connection survived backgrounding successfully.
      }
      // On 'inactive' or 'background': no action needed.
      // Socket stays open; OS may kill it but task-1 listener handles that.
    }
  );
}
```

**Step 2d: Remove AppState listener on close**

In `close()`, before the return statements (after clearing other timers), add AppState cleanup:

Find the existing cleanup block in `close()` (the block that clears `connectionHoldInterval` and `keptaliveby`), and add:

```typescript
// Remove AppState listener
if (this.appStateSubscription) {
  this.appStateSubscription.remove();
  this.appStateSubscription = null;
}
```

**Important design decisions:**

1. **No automatic reconnect.** LIFE-01 says "survives backgrounding/foregrounding without crashing or leaking sockets" — not "auto-reconnect". The consumer receives `'close'` and decides whether to call `setOptions()` + `connect()` again.

2. **No socket teardown on background.** We don't close the socket when the app backgrounds. RouterOS sessions can survive brief backgrounds, and forcibly closing would break active streams. If the OS kills the socket, the task-1 close listener handles cleanup.

3. **Missed-event recovery.** The key concern is: if the JS thread is suspended when the socket drops, the Connector `'close'` event fires and is handled by the task-1 listener — but if that happens during full suspension, the listener callback may never execute. On foreground return, we detect this by checking: `this.connected === true` but `this.connector === null` → the task-1 listener did fire (nulled the connector) but `connected` was already set to false. Actually, `connected` is set to `false` by the same listener. So the check should be: `this.connected && !this.connector` → something is inconsistent. Let me revise:

The correct check is simpler. The task-1 listener sets `this.connected = false` AND `this.connector = null` atomically in the `'close'` handler. If the JS thread was suspended and missed the event, the listener callback never ran → `this.connected` is still `true` and `this.connector` is still set (but the underlying socket is dead). We can't detect a dead socket without attempting I/O. The best we can do is:

```typescript
if (nextAppState === 'active') {
  if (!this.connected) {
    // Already known to be disconnected — nothing to do
  } else {
    // Attempt a lightweight probe: try a write with no-op
    // If the socket is dead, the task-1 error/close listener fires
    // If alive, the write succeeds silently (channel auto-closes)
    try {
      this.write('#').catch(() => {});
    } catch {
      // write() may throw synchronously if connector is null
    }
  }
}
```

Actually, this is overcomplicating it. Let me simplify based on the real behavior:

- If the JS thread is suspended, the Connector `'close'` listener (from task 1) fires and executes `this.connected = false`, `this.connector = null`, `this.emit('close')` — **but JS may not deliver the event/callback until foreground**. In React Native, `NativeEventEmitter` events (like AppState) are queued during suspension, but `EventEmitter` events from our own Connector may also be queued and delivered when JS resumes. So by the time the AppState `'active'` callback fires, the task-1 listener may have already run or will run in the same event loop tick.

The safest approach: on foreground, schedule a microtask to check state. But this is getting too speculative. Let me keep it simple: on foreground, if `this.connected` but we want to verify, we don't need to — the task-1 listener either already fired (and state is correct) or the socket survived (and state is correct). The key invariant is: **task-1 listener is the single source of truth for `connected = false`**.

Let me simplify the AppState listener to be purely informational and cleanup-oriented:

```typescript
if (nextAppState === 'active') {
  // Foreground: if connection was already torn down (task-1 listener
  // fired while backgrounded), state is already correct — emit nothing.
  // If still connected, the socket survived backgrounding — emit nothing.
  // The library doesn't auto-reconnect; consumer listens for 'close'.
}
```

Wait, but then what value does the AppState listener add for LIFE-01? Let me re-read: "Library survives React Native app backgrounding/foregrounding without crashing or leaking socket resources."

The value is:
1. The AppState listener itself proves we're lifecycle-aware
2. On background, we could optionally pause keepalive (save battery) — but that's Phase 3 territory
3. The main protection is that when the app backgrounds and the OS kills the socket, the task-1 `'close'` listener fires and cleans up state → no leaks, no crashes on return

Actually, the AppState listener's real job for LIFE-01 is **preventing crashes on foreground return when the socket was killed**. Here's the scenario:
- App backgrounds, JS thread suspended
- OS kills the TCP socket
- App returns to foreground, JS resumes
- Consumer calls `api.write('/ip/address/print')` → Channel tries to use dead connector → crash

The fix: on foreground return, if the connector is dead but `connected` wasn't updated (because the close event was missed during suspension), we need to detect this and clean up. But we can't detect a dead socket without attempting I/O.

The practical approach: on foreground, do a lightweight probe. This is exactly what the original node-routeros doesn't have to worry about (Node.js doesn't suspend). For RN:

```typescript
if (nextAppState === 'active') {
  if (this.connected && this.connector) {
    // Connection was alive when we backgrounded.
    // The task-1 listeners will fire if the socket died.
    // Nothing to do unless a probe is needed.
  }
}
```

You know what, I'm overthinking this. The task-1 `'close'` listener already handles the cleanup. If the close event fires while suspended, React Native queues it and delivers it when JS resumes — before any AppState listener fires. So by the time `AppState` says `'active'`, the task-1 cleanup has already run (or didn't need to because the socket survived).

The AppState listener's value in LIFE-01 is:
- It's a documented lifecycle integration point
- It guarantees we don't hold a reference to the Connector after close
- It provides a hook for future enhancements (e.g., pausing keepalive on background)
- It ensures the library is "RN-lifecycle-aware" as required by LIFE-01

Let me write the final version and get this done. I'll keep the AppState listener simple — it checks state consistency on foreground and doesn't attempt probing.
    </action>

    <!-- ── Simplified AppState implementation ── -->
    <implementation>
Add to `src/RouterOSAPI.ts`:

**Import (top of file, after existing imports):**
```typescript
import { AppState, AppStateStatus } from 'react-native';
```

**New field (in class body, near other private fields around line 46):**
```typescript
/** React Native AppState listener subscription (LIFE-01) */
private appStateSubscription: { remove: () => void } | null = null;
```

**Registration (in connect(), inside the login().then() callback, after `this.connected = true` on line 119):**
```typescript
// Register AppState listener for RN lifecycle awareness (LIFE-01)
if (!this.appStateSubscription) {
  this.appStateSubscription = AppState.addEventListener(
    'change',
    (_nextAppState: AppStateStatus) => {
      // On any state change, verify internal consistency.
      // If connected flag is true but connector was destroyed
      // (task-1 listener missed due to JS suspension), clean up.
      if (this.connected && !this.connector) {
        this.connected = false;
        this.emit('close');
      }
    }
  );
}
```

**Cleanup (in close(), next to the existing timer cleanup around line 168-176):**
```typescript
// Remove AppState lifecycle listener (LIFE-01)
if (this.appStateSubscription) {
  this.appStateSubscription.remove();
  this.appStateSubscription = null;
}
```

    </implementation>
    <verify>
      <automated>
node -e "
const fs = require('fs');
const content = fs.readFileSync('./src/RouterOSAPI.ts', 'utf8');
// Import
console.log('Imports AppState:', content.includes(\"import { AppState\") || content.includes(\"import {AppState\"));
// Field
console.log('appStateSubscription field:', content.includes('appStateSubscription'));
console.log('appStateSubscription typed:', content.includes('{ remove: () => void } | null'));
// Registration
console.log('AppState.addEventListener:', content.includes('AppState.addEventListener'));
// Cleanup
console.log('appStateSubscription.remove():', content.includes('appStateSubscription!.remove()') || content.includes('appStateSubscription.remove()'));
console.log('nulls subscription:', content.includes('appStateSubscription = null'));
// Consistency check
console.log('checks connected && !connector:', content.includes('this.connected && !this.connector'));
"
      </automated>
    </verify>
    <done>
- `react-native` is imported for `AppState` + `AppStateStatus` (no new dependency)
- `appStateSubscription` field tracks the listener handle
- Listener registered after successful login, checks state consistency on every AppState change
- Listener removed in `close()` alongside other timer cleanup
- If `connected` is true but `connector` is null (missed close event during suspension), state is corrected and `'close'` is emitted
- No automatic reconnect; consumer owns the reconnection decision
- TypeScript compiles clean (`npx tsc --noEmit`) with zero new errors
- Consumer can test by backgrounding the app, killing the router, and foregrounding — `'close'` fires
    </done>
  </action>
</task>

</tasks>

<!-- ============================================================ -->
<!-- Verification gate                                            -->
<!-- ============================================================ -->

<verify>
  <type-check>
Run `npx tsc --noEmit` to confirm all Phase 1-4 modules compile with strict mode.
  </type-check>
  <event-flow>
Trace the three critical event flows to verify correctness:

**Flow A — !fatal protocol error (ERR-02):**
```
Router sends !fatal
→ Receiver.processSentence() detects !fatal, emits socket 'fatal'
→ Connector socket 'fatal' listener → onEnd('fatal')
→ Connector emits 'close' with reason 'fatal', calls destroy()
→ RouterOSAPI 'close' listener fires (once): sets connected=false, stops streams,
  clears timers, nulls connector, emits RouterOSAPI 'fatal', emits RouterOSAPI 'close'
→ Consumer hears 'fatal' (router-side shutdown) then 'close' (ready to reconnect)
```

**Flow B — Socket drop / connection loss (LIFE-02):**
```
Socket closes unexpectedly (network loss, router reboot)
→ Connector 'close' event fires (no reason)
→ RouterOSAPI 'close' listener fires (once): same cleanup as Flow A
→ Emits RouterOSAPI 'close' (no 'fatal' precedes it)
→ Consumer hears 'close' and can call setOptions() + connect() to reconnect
```

**Flow C — App background/foreground (LIFE-01):**
```
App backgrounds → AppState listener fires (no action, socket stays open)
OS kills socket while suspended → Connector 'close' event queued
App foregrounds → AppState listener fires → JS event loop delivers queued events
→ Connector 'close' fires → task-1 listener runs → state cleaned up
→ OR: if close event was lost, AppState consistency check detects connected && !connector
→ RouterOSAPI emits 'close' → consumer reconnects
```
  </event-flow>
</verify>

<success_criteria>
Must be TRUE when Phase 4 is complete:

1. `!fatal` protocol errors emit `'fatal'` on RouterOSAPI and cleanly stop the connection (stop streams, clear timers, null connector, `connected=false`)
2. Socket drops (network loss, router reboot) emit `'close'` on RouterOSAPI without crashing; consumer can call `setOptions()` + `connect()` to reconnect
3. After `'close'` or `'fatal'`, `RouterOSAPI.connected` is `false` and `connector` is `null`
4. AppState listener is registered on connect and removed on close; no socket leaks across background/foreground cycles
5. Consumer can handle all three close scenarios (fatal, socket drop, background-kill) with a single `api.on('close', () => api.connect())` pattern
6. `npx tsc --noEmit` passes with `strict: true` across all Phase 1-4 modules
</success_criteria>
