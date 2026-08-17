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
 * routeros, like /tool/torch which keeps
 * sending data endlessly.
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
