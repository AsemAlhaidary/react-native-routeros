---
phase: 03-commands-streaming
plan: 03
type: execute
wave: 1
depends_on: ["02-protocol-connection"]
files_modified:
  - src/RouterOSAPI.ts
  - src/RStream.ts
  - src/Channel.ts
  - src/index.ts
autonomous: true
requirements:
  - CONN-06
  - CMDS-01
  - CMDS-02
  - CMDS-03
  - CMDS-04
  - STRM-01
  - STRM-02
  - STRM-03
  - STRM-04

must_haves:
  truths:
    - "npx tsc --noEmit passes with strict:true and produces zero errors across all Phase 3 modules plus Phases 1-2"
    - "write([]) returns a Promise that resolves with parsed response data on !done and rejects with RosException on !trap"
    - "writeStream([]) returns an RStream that emits 'data'/'done'/'trap'/'close' events and the consumer can listen to each sentence as it arrives"
    - "stream([]) returns an RStream for continuous endpoints like /ip/address/listen or /tool/torch, with callback receiving (err, packet, stream) per sentence"
    - "openChannel() returns a Channel with a unique .tag; consumer can channel.write(['/ip/address/print']) to manage a named tag directly"
    - "Multiple simultaneous write() calls work independently — each gets a unique tag and their responses do not interleave"
    - "keepaliveBy(n) sends a command every (timeout/2) seconds to prevent RouterOS session timeout; continues across channel open/close cycles"
    - "RStream.pause() sends /cancel and stops the channel; RStream.resume() re-starts the stream on the same channel"
    - "RStream.stop() permanently closes the stream and channel; it cannot be resumed after"
    - "RStream's empty-data debounce works correctly — when streaming endpoints have an =interval=X parameter, empty-data bursts are emitted at X seconds minus 300ms matching original node-routeros behavior"
  artifacts:
    - src/RouterOSAPI.ts (expanded: public write, writeStream, stream, keepaliveBy with full signatures)
    - src/RStream.ts (new file: ported from node-routeros RStream.js)
    - src/Channel.ts (no structural changes — already supports streaming and streaming flag)
    - src/index.ts (updated barrel with Phase 3 exports)
  key_links:
    - "RouterOSAPI.write() → openChannel() → Channel.write(params) → Connector.write(encoded) → Transmitter → socket"
    - "RouterOSAPI.writeStream() → openChannel() → new RStream(channel, params) → channel.write(params, isStream=true, returnPromise=false) → channel emits 'stream' → RStream.onStream()"
    - "RouterOSAPI.stream() → openChannel() → new RStream(channel, params, callback) → RStream.prepareDebounceEmptyData() → RStream.start()"
    - "RStream → Channel (owns) + Connector (via channel.Connector) + utils.debounce (empty-data debouncing) + global setTimeout/clearTimeout (RN-safe, not timers module)"
    - "RouterOSAPI.keepaliveBy() → write() in a recursive setTimeout loop at half-timeout intervals"
    - "RouterOSAPI.openChannel() → returns Channel with unique .tag; consumer uses channel.write() + channel.on('done'/'trap') for direct tagged command management"
---

<objective>
Build the command-and-streaming layer on top of Phase 2's connect+login foundation. The consumer can send arbitrary RouterOS CLI commands via `write()`, receive streaming data sentence-by-sentence via `writeStream()`, open continuous data streams via `stream()` with RStream pause/resume/stop lifecycle, manage multiple concurrent tagged channels independently, and configure periodic keepalive to prevent RouterOS session timeout. All 9 Phase 3 requirements (CONN-06, CMDS-01..04, STRM-01..04) are satisfied.

Purpose: Deliver the full node-routeros command surface — the library can now do everything the original can do at the API level. A consumer can `connect()` + `login()` and then issue any RouterOS CLI command, stream torches and listeners, and keep the session alive.
</objective>

<execution_context>
@C:/Users/Asem/.config/opencode/gsd-core/workflows/execute-plan.md
@C:/Users/Asem/.config/opencode/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/PROJECT.md
@node-routeros/dist/RouterOSAPI.js (write, writeStream, stream, keepaliveBy, openChannel, concatParams — all non-login sections)
@node-routeros/dist/RStream.js (full streaming class)
@node-routeros/dist/RStream.d.ts (constructor, data, pause, resume, stop, close, start type signatures)
@node-routeros/dist/Channel.js (write isStream flag, processPacket routing)
@node-routeros/dist/utils.js (debounce utility — already ported in Phase 1)
@src/RouterOSAPI.ts (current state: connect, login, close, private write stub, private keepaliveBy stub, openChannel, hold/release)
@src/Channel.ts (current state: write with isStream flag, streaming guard in close, stream emit in processPacket — fully ready)
@src/Connector.ts (current state: write, read, stopRead, close, destroy — fully ready)
@src/index.ts (current barrel exports)
@src/utils.ts (debounce utility already ported from Phase 1)
</context>

<tasks>

<!-- ============================================================ -->
<!-- WAVE 1: RStream (parallel with RouterOSAPI — 2 tasks)         -->
<!-- ============================================================ -->

<!-- ============== TASK 1: RStream — new file ============== -->
<task type="auto">
  <name>Port RStream: continuous data streaming class</name>
  <files>src/RStream.ts</files>
  <action>
Create `src/RStream.ts` — port the original `node-routeros/dist/RStream.js` to TypeScript. RStream manages continuous data flows from RouterOS endpoints like `/ip/address/listen` or `/tool/torch`.

**Source reference:** `node-routeros/dist/RStream.js` (277 lines), `node-routeros/dist/RStream.d.ts` (143 lines)

**RN adaptations (from PITFALLS.md and STACK.md):**
1. Replace `require('timers')` → use global `setTimeout`/`clearTimeout` (available in RN/Hermes without imports)
2. Replace `require('./utils').debounce` → import `debounce` from `./utils` (already ported in Phase 1)
3. Replace `require('events').EventEmitter` → import `EventEmitter` from `events` (Phase 2 dependency)
4. `Buffer` is never used in RStream.js — no replacement needed
5. Channel already imported from `./Channel`

**Full implementation:**

```typescript
import { EventEmitter } from 'events';
import createDebug from 'debug';
import { Channel } from './Channel';
import { RosException } from './RosException';
import { debounce } from './utils';

const debugInfo = createDebug('routeros-api:rstream:info');
const debugError = createDebug('routeros-api:rstream:error');

/**
 * Stream class is responsible for handling
 * continuous data from some parts of the
 * routeros, like /ip/address/listen or
 * /tool/torch which keeps sending data endlessly.
 * It is also possible to pause/resume/stop generated
 * streams.
 *
 * Ported verbatim from node-routeros RStream.js.
 * Only change: timers module → global setTimeout/clearTimeout,
 * utils.debounce → ./utils import.
 */
export class RStream extends EventEmitter {
  /** Main channel of the stream */
  private channel: Channel;

  /** Parameters of the menu and search of what to stream */
  private params: string[];

  /** The callback function sent to the streaming listener */
  private callback?: (err: Error | null, packet?: any, stream?: RStream) => void;

  /** The function that will send empty data unless debounced by real data */
  private debounceSendingEmptyData?: { run: () => void; cancel: () => void };

  /** Flag for turning on empty data debouncing */
  private shouldDebounceEmptyData = false;

  /** If is streaming flag */
  private streaming = true;

  /** If is pausing flag */
  private pausing = false;

  /** If is paused flag */
  private paused = false;

  /** If is stopping flag */
  private stopping = false;

  /** If is stopped flag */
  private stopped = false;

  /** If got a trap error */
  private trapped = false;

  /** Save the current section of the packet, if has any */
  private currentSection: string | null = null;

  private forcelyStop = false;

  /** Store the current section in a single array before sending when another section comes */
  private currentSectionPacket: Record<string, any>[] = [];

  /** Waiting timeout before sending received section packets */
  private sectionPacketSendingTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Constructor, it does NOT start the streaming automatically.
   * Call .start() after construction to begin.
   *
   * @param channel  An open channel for this stream
   * @param params   RouterOS command parameters
   * @param callback Optional callback receiving (err, packet, stream)
   */
  constructor(
    channel: Channel,
    params: string[],
    callback?: (err: Error | null, packet?: any, stream?: RStream) => void
  ) {
    super();
    this.channel = channel;
    this.params = params;
    this.callback = callback;
  }

  /**
   * Function to receive the callback which will receive data,
   * if not provided over the constructor or changed later
   * after the streaming have started.
   */
  data(
    callback: (err: Error | null, packet?: any, stream?: RStream) => void
  ): void {
    this.callback = callback;
  }

  /**
   * Resume the paused stream, using the same channel.
   *
   * @returns Promise resolving when resumed
   */
  resume(): Promise<void> {
    if (this.stopped || this.stopping) {
      return Promise.reject(new RosException('STREAMCLOSD'));
    }
    if (!this.streaming) {
      this.pausing = false;
      this.start();
      this.streaming = true;
    }
    return Promise.resolve();
  }

  /**
   * Pause the stream, but don't destroy the channel.
   * Sends /cancel to stop data flow, channel stays open for resume.
   *
   * @returns Promise resolving when paused
   */
  pause(): Promise<void> {
    if (this.stopped || this.stopping) {
      return Promise.reject(new RosException('STREAMCLOSD'));
    }
    if (this.pausing || this.paused) {
      return Promise.resolve();
    }
    if (this.streaming) {
      this.pausing = true;
      return this.stop(true).then(() => {
        this.pausing = false;
        this.paused = true;
        return Promise.resolve();
      });
    }
    return Promise.resolve();
  }

  /**
   * Stop the stream entirely, can't re-stream after
   * this if called directly.
   *
   * @param pausing  If true, don't set forcelyStop (internal for pause)
   * @returns Promise resolving when stopped
   */
  stop(pausing: boolean = false): Promise<void> {
    if (this.stopped || this.stopping) {
      return Promise.resolve();
    }

    if (!pausing) {
      this.forcelyStop = true;
    }

    if (this.paused) {
      this.streaming = false;
      this.stopping = false;
      this.stopped = true;
      if (this.channel) {
        this.channel.close(true);
      }
      return Promise.resolve();
    }

    if (!this.pausing) {
      this.stopping = true;
    }

    let chann: Channel | null = new Channel(this.channel.Connector);
    chann.on('close', () => {
      chann = null;
    });

    if (this.debounceSendingEmptyData) {
      this.debounceSendingEmptyData.cancel();
    }

    return (chann.write(['/cancel', '=tag=' + this.channel.Id]) as Promise<any>)
      .then(() => {
        this.streaming = false;
        if (!this.pausing) {
          this.stopping = false;
          this.stopped = true;
        }
        this.emit('stopped');
        return Promise.resolve();
      })
      .catch((err) => {
        return Promise.reject(err);
      });
  }

  /**
   * Alias for stop()
   */
  close(): Promise<void> {
    return this.stop();
  }

  /**
   * Write over the connection and start the stream.
   * Called by RouterOSAPI.writeStream() and RouterOSAPI.stream().
   */
  start(): void {
    if (!this.stopped && !this.stopping) {
      this.channel.on('close', () => {
        if (this.forcelyStop || (!this.pausing && !this.paused)) {
          if (!this.trapped) {
            this.emit('done');
          }
          this.emit('close');
        }
        this.stopped = false;
      });

      this.channel.on('stream', (packet: Record<string, any>) => {
        if (this.debounceSendingEmptyData) {
          this.debounceSendingEmptyData.run();
        }
        this.onStream(packet);
      });

      this.channel.once('trap', this.onTrap.bind(this));
      this.channel.once('done', this.onDone.bind(this));

      this.channel.write(this.params.slice(), true, false);
      this.emit('started');

      if (this.shouldDebounceEmptyData) {
        this.prepareDebounceEmptyData();
      }
    }
  }

  /**
   * Prepare the debounce for empty data.
   * When streaming endpoints have an =interval=X parameter,
   * empty-data bursts are emitted at X seconds minus 300ms.
   * This matches original node-routeros behavior.
   */
  prepareDebounceEmptyData(): void {
    this.shouldDebounceEmptyData = true;

    const intervalParam = this.params.find((param) => {
      return /=interval=/.test(param);
    });

    let interval = 2000; // default: 2 seconds
    if (intervalParam) {
      const val = intervalParam.split('=')[2];
      interval = parseInt(val, 10) * 1000;
    }

    this.debounceSendingEmptyData = debounce(() => {
      if (
        !this.stopped &&
        !this.stopping &&
        !this.paused &&
        !this.pausing
      ) {
        this.onStream({});
        this.debounceSendingEmptyData!.run();
      }
    }, interval + 300);
  }

  // ──── Private event handlers ────

  /**
   * When receiving the stream packet, give it to the callback.
   *
   * Section packets (with `.section` property) are buffered and
   * sent as a group after a 300ms timeout to group related data.
   */
  private onStream(packet: Record<string, any>): void {
    this.emit('data', packet);

    if (this.callback) {
      if (packet['.section']) {
        if (this.sectionPacketSendingTimeout) {
          clearTimeout(this.sectionPacketSendingTimeout);
        }

        const sendData = () => {
          this.callback!(null, this.currentSectionPacket.slice(), this);
          this.currentSectionPacket = [];
        };

        this.sectionPacketSendingTimeout = setTimeout(sendData, 300);

        if (
          this.currentSectionPacket.length > 0 &&
          packet['.section'] !== this.currentSection
        ) {
          clearTimeout(this.sectionPacketSendingTimeout);
          sendData();
        }

        this.currentSection = packet['.section'];
        this.currentSectionPacket.push(packet);
      } else {
        this.callback(null, packet, this);
      }
    }
  }

  /**
   * When receiving a trap over the connection.
   * When pausing, will receive an 'interrupted' message —
   * this will not be considered as an error but a flag
   * for the pause and resume function.
   */
  private onTrap(data: Record<string, any>): void {
    if (data.message === 'interrupted') {
      this.streaming = false;
    } else {
      this.stopped = true;
      this.trapped = true;
      if (this.callback) {
        this.callback(new Error(data.message), null, this);
      } else {
        this.emit('error', data);
      }
      this.emit('trap', data);
    }
  }

  /**
   * When the channel stops sending data.
   * It will close the channel if the intention was stopping it.
   */
  private onDone(): void {
    if (this.stopped && this.channel) {
      this.channel.close(true);
    }
  }
}
```

**Key points — what changed from original:**
1. `require('timers')` → global `setTimeout`/`clearTimeout` (RN/Hermes has these globally — PITFALLS.md confirms no polyfill needed)
2. `require('./utils').debounce` → import `debounce` from `./utils` (Phase 1 already exported)
3. TypeScript typings throughout: constructor types, callback signature `(err: Error | null, packet?: any, stream?: RStream) => void`, member visibility
4. Debug namespace preserved: `routeros-api:rstream:info` and `routeros-api:rstream:error`

**What stays identical:**
- Flags: `streaming`, `pausing`, `paused`, `stopping`, `stopped`, `trapped`, `forcelyStop`
- `start()` — channel event wiring ('close', 'stream', 'trap', 'done'), channel.write(params.slice(), true, false)
- `pause()` / `resume()` / `stop()` — full state machine preserved
- `prepareDebounceEmptyData()` — `=interval=` detection, `interval + 300` debounce window
- `onStream()` — section packet buffering with 300ms timeout, `.section` detection
- `onTrap()` — `'interrupted'` vs real error branching
- `onDone()` — conditional channel.close(true) when stopped

Read first: `node-routeros/dist/RStream.js` (full file — 277 lines), `node-routeros/dist/RStream.d.ts` (type signatures), PITFALLS.md sections on timer availability in Hermes.
  </action>
  <verify>
    <automated>
# Verify RStream structure and algorithm integrity
node -e "
const fs = require('fs');
const content = fs.readFileSync('./src/RStream.ts', 'utf8');
console.log('RStream class exported:', content.includes('export class RStream'));
console.log('Extends EventEmitter:', content.includes('extends EventEmitter'));
console.log('Has constructor:', content.includes('constructor('));
console.log('Has start():', content.includes('start()'));
console.log('Has pause():', content.includes('pause()'));
console.log('Has resume():', content.includes('resume()'));
console.log('Has stop():', content.includes('stop('));
console.log('Has close():', content.includes('close()'));
console.log('Has data():', content.includes('data(callback'));
console.log('Has prepareDebounceEmptyData():', content.includes('prepareDebounceEmptyData()'));
console.log('Has onStream():', content.includes('onStream('));
console.log('Has onTrap():', content.includes('onTrap('));
console.log('Has onDone():', content.includes('onDone()'));
// RN adaptations
console.log('NO require(timers):', !content.includes(\"require('timers')\") && !content.includes('require(\"timers\")'));
console.log('Uses setTimeout:', content.includes('setTimeout'));
console.log('Uses clearTimeout:', content.includes('clearTimeout'));
console.log('Imports debounce from ./utils:', content.includes(\"./utils\") && content.includes('debounce'));
console.log('Imports Channel:', content.includes('./Channel'));
console.log('Imports RosException:', content.includes('./RosException'));
// State flags
console.log('streaming flag:', content.includes('streaming'));
console.log('pausing flag:', content.includes('pausing'));
console.log('paused flag:', content.includes('paused'));
console.log('stopping flag:', content.includes('stopping'));
console.log('stopped flag:', content.includes('stopped'));
console.log('trapped flag:', content.includes('trapped'));
console.log('forcelyStop flag:', content.includes('forcelyStop'));
// Streaming logic
console.log('section packet buffering:', content.includes('.section'));
console.log('300ms section timeout:', content.includes('300'));
console.log('=interval= detection:', content.includes('=interval='));
console.log('interrupted trap handling:', content.includes('interrupted'));
console.log('STREAMCLOSD error:', content.includes('STREAMCLOSD'));
"
    </automated>
  </verify>
  <done>
- `src/RStream.ts` compiles as part of full `tsc --noEmit` (verified in final wave)
- All original state flags present: streaming, pausing, paused, stopping, stopped, trapped, forcelyStop
- `start()` wires channel events (close, stream, trap, done) and writes params with isStream=true
- `pause()` sends /cancel, sets paused=true, preserves channel for resume
- `resume()` re-calls start() on same channel
- `stop()` forcefully cancels and closes channel; cannot resume after
- `close()` is alias for stop()
- `data(callback)` allows setting/changing callback post-construction
- `prepareDebounceEmptyData()` detects `=interval=X` in params and sets debounce at `X*1000 + 300` ms
- Section packets (`.section` property) buffered and flushed after 300ms timeout
- `onTrap()` distinguishes `'interrupted'` (pause signal) from real errors
- Zero Node.js imports — uses global setTimeout/clearTimeout (no `require('timers')`)
- `debounce` imported from Phase 1 `./utils` (not `require('./utils')`)
  </done>
</task>

<!-- ============== TASK 2: RouterOSAPI — command + streaming methods ============== -->
<task type="auto">
  <name>Elevate RouterOSAPI: public write, writeStream, stream, keepaliveBy</name>
  <files>src/RouterOSAPI.ts</files>
  <action>
Transform `src/RouterOSAPI.ts` from its Phase 2 state (connect+login+close only) to the full command surface. The private `write()` and `keepaliveBy()` stubs become fully public, and `writeStream()`/`stream()` are added.

**Source reference:** `node-routeros/dist/RouterOSAPI.js` lines 131-236 (write, writeStream, stream, keepaliveBy, openChannel, concatParams)

**Changes to make (in order):**

### 2a. Add RStream import

At the top of the file, add:
```typescript
import { RStream } from './RStream';
```

### 2b. Replace the private `write()` with the full public version

The existing private `write(command, params)` on lines 328-338 only handles the login flow. Replace it with the full public API that:
- Accepts variadic params matching the original: `write(params: string | string[], ...moreParams: (string | string[])[])`
- Uses `concatParams()` to normalize all parameters
- Opens a channel, wires close/cleanup, returns Promise

```typescript
/**
 * Writes a command over the socket to the routerboard
 * on a new channel.
 *
 * @param params       Command path (string) or full params array
 * @param moreParams   Additional parameters (spread)
 * @returns            Promise resolving with parsed response data on !done,
 *                     rejecting with RosException on !trap
 */
write(
  params: string | string[],
  ...moreParams: (string | string[])[]
): Promise<Record<string, any>[]> {
  params = this.concatParams(params, moreParams);
  let chann: Channel | null = this.openChannel();
  this.holdConnection();

  chann.once('close', () => {
    chann = null; // GC hint (matches original)
    this.decreaseChannelsOpen();
    this.releaseConnectionHold();
  });

  return chann.write(params) as Promise<Record<string, any>[]>;
}
```

**Important:** The `login()` method calls `this.write('/login', [...])` — but that call uses the old private signature `write(command: string, params: string[])`. The new public signature uses variadic `...moreParams`. The call `this.write('/login', ['=name=...'])` would now pass the array as the first element of `moreParams`, then `concatParams` unwraps it. This works because `concatParams` handles both string and array arguments. **Verify login() still works** by tracing the concatParams logic:

```
write('/login', ['=name=user']) → concatParams('/login', [['=name=user']]) → ['/login', '=name=user'] ✅
write(['/login', '=name=user']) → concatParams(['/login', '=name=user'], []) → ['/login', '=name=user'] ✅
write('/system/resource/print') → concatParams('/system/resource/print', []) → ['/system/resource/print'] ✅
write('/ip/address/print', '=interface=ether1') → concatParams('/ip/address/print', ['=interface=ether1']) → ['/ip/address/print', '=interface=ether1'] ✅
```

### 2c. Rename `concatParams` and make it public

The existing `concatParams` is identical to the original — just move it from private to public and keep the implementation:

```typescript
/**
 * Concatenate parameters into a flat string array.
 * Handles both string and array arguments (variadic).
 */
concatParams(
  firstParameter: string | string[],
  parameters: (string | string[])[]
): string[] {
  if (typeof firstParameter === 'string') {
    firstParameter = [firstParameter];
  }
  for (let parameter of parameters) {
    if (typeof parameter === 'string') {
      parameter = [parameter];
    }
    if (parameter.length > 0) {
      firstParameter = firstParameter.concat(parameter);
    }
  }
  return firstParameter;
}
```

### 2d. Add `writeStream()`

```typescript
/**
 * Writes a command over the socket to the routerboard
 * on a new channel and returns an RStream that emits
 * 'data', 'done', 'trap', and 'close' events.
 *
 * @param params       Command path (string) or full params array
 * @param moreParams   Additional parameters (spread)
 * @returns            RStream — listen to 'data' for each sentence
 */
writeStream(
  params: string | string[],
  ...moreParams: (string | string[])[]
): RStream {
  params = this.concatParams(params, moreParams);
  const stream = new RStream(this.openChannel(), params as string[]);

  stream.on('started', () => {
    this.holdConnection();
  });
  stream.on('stopped', () => {
    this.unregisterStream(stream);
    this.decreaseChannelsOpen();
    this.releaseConnectionHold();
  });

  stream.start();
  this.registerStream(stream);
  return stream;
}
```

### 2e. Add `stream()`

```typescript
/**
 * Returns a stream object for handling continuous data
 * flow. Used for endpoints like /ip/address/listen or
 * /tool/torch that keep sending data endlessly.
 *
 * @param params       Command path or params array
 * @param moreParams   Additional params + optional callback as last arg
 * @returns            RStream with empty-data debouncing enabled
 */
stream(
  params: string | string[] = [],
  ...moreParams: (string | string[] | ((err: Error | null, packet?: any, stream?: RStream) => void))[]
): RStream {
  let callback = moreParams.pop() as
    | ((err: Error | null, packet?: any, stream?: RStream) => void)
    | undefined;

  if (typeof callback !== 'function') {
    if (callback) {
      moreParams.push(callback as any);
    }
    callback = undefined;
  }

  params = this.concatParams(
    params,
    moreParams as (string | string[])[]
  );

  const stream = new RStream(
    this.openChannel(),
    params as string[],
    callback
  );

  stream.on('started', () => {
    this.holdConnection();
  });
  stream.on('stopped', () => {
    this.unregisterStream(stream);
    this.decreaseChannelsOpen();
    this.releaseConnectionHold();
    stream.removeAllListeners();
  });

  stream.start();
  stream.prepareDebounceEmptyData();
  this.registerStream(stream);
  return stream;
}
```

### 2f. Replace the private `keepaliveBy()` with the full public version

The current stub on lines 408-424 sends a hardcoded `'#'` command. Replace with the full version that matches the original:

```typescript
/**
 * Keep the connection alive by running a set of
 * commands provided instead of the random command.
 *
 * Sends the command every (timeout / 2) seconds.
 * Continues across channel open/close cycles.
 *
 * @param params       Command string or array to send as keepalive
 * @param moreParams   Additional params + optional callback as last arg
 */
keepaliveBy(
  params: string | string[] = '#',
  ...moreParams: (
    | string
    | string[]
    | ((err: Error | null, data?: any) => void)
  )[]
): void {
  this.holdingConnectionWithKeepalive = true;

  if (this.keptaliveby) {
    clearTimeout(this.keptaliveby);
  }

  let callback = moreParams.pop() as
    | ((err: Error | null, data?: any) => void)
    | undefined;

  if (typeof callback !== 'function') {
    if (callback) {
      moreParams.push(callback as any);
    }
    callback = undefined;
  }

  params = this.concatParams(
    params,
    moreParams as (string | string[])[]
  );

  const exec = () => {
    if (!this.closing) {
      if (this.keptaliveby) {
        clearTimeout(this.keptaliveby);
      }
      this.keptaliveby = setTimeout(() => {
        (this.write(params as string[]) as Promise<Record<string, any>[]>)
          .then((data) => {
            if (typeof callback === 'function') {
              callback(null, data);
            }
            exec();
          })
          .catch((err) => {
            if (typeof callback === 'function') {
              callback(err, null);
            }
            exec();
          });
      }, (this.timeout * 1000) / 2);
    }
  };

  exec();
}
```

### 2g. `openChannel()` is already public — no changes needed

The existing `openChannel()` (lines 195-198) returns a `Channel` and calls `increaseChannelsOpen()`. This already satisfies CMDS-04 (open explicit tagged channel). The consumer can:
```typescript
const ch = api.openChannel();
ch.once('done', (data) => console.log(data));
ch.once('trap', (err) => console.error(err));
ch.write(['/ip/address/print']);
```

### 2h. Verify `connect()` still works

The connect() method calls `this.keepaliveBy('#')` on line 135 when `this.keepalive` is true. The new signature `keepaliveBy(params, ...moreParams)` with default `params = '#'` works identically for the no-argument call `this.keepaliveBy('#')`.

### 2i. Update the class docstring

Update the Phase 2 comment on line 17-19:
```typescript
/**
 * RouterOSAPI — main public API for connecting to and
 * communicating with MikroTik RouterOS devices.
 *
 * Ported from node-routeros RouterOSAPI.js.
 * Phase 2: connect(), login(), setOptions(), close()
 * Phase 3: write(), writeStream(), stream(), keepaliveBy(), openChannel()
 */
```

**Key points — what changed from original:**
1. All method signatures use TypeScript typings (Promise return types, callback types)
2. `private write(command, params)` → `public write(params, ...moreParams)` with full variadic support
3. `keptaliveby` timer uses `ReturnType<typeof setTimeout>` (Phase 2 type is correct)
4. `registeredStreams` uses `RStream[]` instead of `any[]` (line 47 — update the type)
5. Debug namespaces preserved: `routeros-api:api:info` and `routeros-api:api:error`
6. `concatParams` implementation is verbatim from the original

Read first: `node-routeros/dist/RouterOSAPI.js` lines 1-236 (full file excluding the constructor), the existing `src/RouterOSAPI.ts` (current state), and the Channel.write() signature (to confirm isStream and returnPromise params).
  </action>
  <verify>
    <automated>
# Verify RouterOSAPI has all public methods with correct signatures
node -e "
const fs = require('fs');
const content = fs.readFileSync('./src/RouterOSAPI.ts', 'utf8');
console.log('Has public write():', content.includes('write('));
console.log('write returns Promise:', content.includes('Promise<Record<string, any>[]>'));
console.log('Has writeStream():', content.includes('writeStream('));
console.log('writeStream returns RStream:', content.includes('RStream'));
console.log('Has stream():', content.includes('stream('));
console.log('stream returns RStream:', (content.match(/RStream/g) || []).length >= 2);
console.log('Has keepaliveBy():', content.includes('keepaliveBy('));
console.log('keepaliveBy has setTimeout:', content.includes('setTimeout'));
console.log('Has openChannel():', content.includes('openChannel()'));
console.log('Has concatParams():', content.includes('concatParams('));
console.log('concatParams is public:', !content.includes('private concatParams'));
// Check the old private write is gone
console.log('No private write stub:', !content.includes('private write(command: string, params: string[]'));
// RN safety
console.log('Uses imported EventEmitter:', content.includes(\"from 'events'\"));
console.log('Imports RStream:', content.includes(\"./RStream\"));
console.log('Imports Channel:', content.includes('./Channel'));
console.log('Imports Connector:', content.includes('./Connector'));
// registeredStreams typed
console.log('registeredStreams typed:', content.includes('registeredStreams: RStream[]'));
// keepalive logic
console.log('keepalive interval (timeout/2):', content.includes('this.timeout * 1000) / 2'));
console.log('holdingConnectionWithKeepalive flag:', content.includes('holdingConnectionWithKeepalive'));
"
    </automated>
  </verify>
  <done>
- `src/RouterOSAPI.ts` compiles as part of full `tsc --noEmit` (verified in final wave)
- `write(params, ...moreParams)` is public, returns `Promise<Record<string, any>[]>`, resolves on !done, rejects on !trap
- `write()` opens a channel, wires close/cleanup, sends via `chann.write(params)`, and returns the Promise
- `writeStream(params, ...moreParams)` returns an RStream that emits 'data'/'done'/'trap'/'close'
- `stream(params, ...moreParams)` returns an RStream with empty-data debouncing (calls `prepareDebounceEmptyData()`)
- `stream()` extracts callback from last variadic arg, matching original intellisense-friendly signature
- `keepaliveBy(params, ...moreParams)` sends command every (timeout/2)s in recursive setTimeout loop
- `keepaliveBy()` extracts callback from last variadic arg for success/error notification
- `openChannel()` is already public and works as-is — returns Channel with unique .tag (CMDS-04)
- `concatParams()` moved to public, handles string/array flattening exactly like original
- `connect()` still calls `keepaliveBy('#')` correctly when `this.keepalive` is true
- `close()` still stops all streams, clears timers, and destroys connector
- `registeredStreams` typed as `RStream[]` (was `any[]`)
- All original channel bookkeeping preserved: increaseChannelsOpen, decreaseChannelsOpen, registerStream, unregisterStream, stopAllStreams
- All original connection hold logic preserved: holdConnection, releaseConnectionHold
  </done>
</task>

<!-- ============================================================ -->
<!-- WAVE 2: Barrel export + type-check (depends on Wave 1)        -->
<!-- ============================================================ -->

<!-- ============== TASK 3: Barrel export ============== -->
<task type="tracer">
  <name>Update barrel: export RStream from index.ts</name>
  <files>src/index.ts</files>
  <action>
Add the Phase 3 exports to `src/index.ts`. The existing file already has Phase 1 and Phase 2 exports.

After the Phase 2 section (line 18), add:

```typescript
// Phase 3: Commands + Streaming
export { RStream } from './RStream';
```

No existing exports are changed or removed. RouterOSAPI and Channel are already exported from Phase 2.
  </action>
  <verify>
    <automated>
# Verify index exports RStream
node -e "
const fs = require('fs');
const content = fs.readFileSync('./src/index.ts', 'utf8');
console.log('Exports RStream:', content.includes(\"export { RStream }\") || content.includes(\"export { RStream,\") || content.includes(\", RStream }\"));
console.log('RStream from ./RStream:', content.includes(\"./RStream\"));
"
    </automated>
  </verify>
  <done>
- `src/index.ts` exports `RStream` from `./RStream`
- Existing Phase 1 and Phase 2 exports unchanged
- Barrel file compiles as part of full `tsc --noEmit`
  </done>
</task>

<!-- ============== TASK 4: TypeScript type-check (Wave 2 gate) ============== -->
<task type="tracer">
  <name>Type-check all Phase 3 modules: npx tsc --noEmit</name>
  <files>src/RouterOSAPI.ts, src/RStream.ts, src/Channel.ts, src/index.ts</files>
  <action>
Run the full TypeScript compiler in no-emit mode to verify all Phase 1-3 modules compile cleanly with strict mode.

```bash
npx tsc --noEmit
```

**Expected output:** zero errors. If there are errors, fix them before marking this task done.

**Common error patterns to watch for:**
- `Channel.write()` returns `Promise<Record<string, any>[]> | void` — the RStream calls `channel.write(params, true, false)` which returns `void`. The RouterOSAPI write() casts the return: `chann.write(params) as Promise<Record<string, any>[]>`.
- `RStream` constructor type: `params` is `string[]` but `concatParams` returns `(string | string[])[]` — cast to `string[]`.
- `debounce` return type: `{ run: () => void; cancel: () => void }` — matches `debounceSendingEmptyData` type.
- `registeredStreams` type needs to change from `any[]` to `RStream[]`.
  </action>
  <verify>
    <automated>
npx tsc --noEmit
    </automated>
  </verify>
  <done>
- `npx tsc --noEmit` exits with code 0
- Zero TypeScript errors across all Phase 1-3 modules
- `strict: true` enforced (inherited from tsconfig.json)
- All public API types are correctly exported and importable
  </done>
</task>

</tasks>
