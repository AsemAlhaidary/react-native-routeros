import createDebug from 'debug';
import { decodeWin1252 } from './win1252';
import { RosException } from './RosException';
import { RosSocket } from './transport/SocketAdapter';

const debug = createDebug('routeros-api:connector:receiver');

/** Single 0x00 byte — RouterOS sentence terminator */
const NULL_BYTE = new Uint8Array([0x00]);

interface TagEntry {
  name: string;
  callback: (packet: string[]) => void;
}

interface SentenceEntry {
  sentence: string;
  hadMore: boolean;
}

/**
 * Class responsible for receiving and parsing socket data,
 * decoding RouterOS sentences, and routing them to registered
 * tag callbacks.
 *
 * Ported verbatim from node-routeros Receiver.js.
 * Only change: iconv.decode(data, 'win1252') → decodeWin1252(bytes).
 */
export class Receiver {
  /** Registered tag callbacks — keyed by tag string */
  private tags = new Map<string, TagEntry>();

  /** Remaining bytes expected for the current word being read */
  private dataLength = 0;

  /** Queue of parsed sentences awaiting processing */
  private sentencePipe: SentenceEntry[] = [];

  /** Guard to prevent concurrent sentence processing */
  private processingSentencePipe = false;

  /** Current word being accumulated from socket data */
  private currentLine = '';

  /** Current reply type (!done, !trap, !fatal, !re, !empty) */
  private currentReply = '';

  /** Current tag for the sentence being processed */
  private currentTag = '';

  /** Accumulated data lines for the current tag's response */
  private currentPacket: string[] = [];

  /**
   * Partial length-descriptor bytes carried over from a previous
   * processRawData() call when the descriptor spanned a chunk boundary.
   */
  private lengthDescriptorSegment: Uint8Array | null = null;

  private socket: RosSocket;

  constructor(socket: RosSocket) {
    this.socket = socket;
  }

  /**
   * Register a tag to receive data callbacks.
   * Called by Connector.read() → Channel.readAndWrite().
   */
  read(tag: string, callback: (packet: string[]) => void): void {
    debug('Reader of %s tag is being set', tag);
    this.tags.set(tag, { name: tag, callback });
  }

  /**
   * Remove a tag from the registry.
   * Called by Connector.stopRead() → Channel.close().
   */
  stop(tag: string): void {
    debug('Not reading from %s tag anymore', tag);
    this.tags.delete(tag);
  }

  /**
   * Process raw binary data received from the socket.
   *
   * Decodes RouterOS length-prefixed words using win1252,
   * assembles sentences, and pushes them to the sentence pipe.
   * After each sentence boundary, triggers processSentence().
   *
   * @param data  Raw bytes from socket 'data' event.
   */
  processRawData(data: Uint8Array): void {
    // If we have a partial length descriptor from a previous chunk,
    // prepend it to the new data.
    if (this.lengthDescriptorSegment) {
      const combined = new Uint8Array(
        this.lengthDescriptorSegment.length + data.length
      );
      combined.set(this.lengthDescriptorSegment);
      combined.set(data, this.lengthDescriptorSegment.length);
      data = combined;
      this.lengthDescriptorSegment = null;
    }

    // Loop through the data we just received
    while (data.length > 0) {
      // If this does not contain the beginning of a packet...
      if (this.dataLength > 0) {
        // If the length of the data we have is ≤ the reported word length
        if (data.length <= this.dataLength) {
          // Subtract the bytes we are consuming
          this.dataLength -= data.length;
          // Decode this chunk and append to current line
          this.currentLine += decodeWin1252(data);
          // If we've consumed the full word
          if (this.dataLength === 0) {
            // Push the sentence to the pipe
            this.sentencePipe.push({
              sentence: this.currentLine,
              hadMore: false, // data.length is 0 here since we consumed all
            });
            // Process the sentence and clear the line
            this.processSentence();
            this.currentLine = '';
          }
          // Break out and wait for the next data chunk from the socket
          break;
        } else {
          // We have more data than the current word demands
          // Slice off exactly the portion we need for this word
          const wordBytes = data.slice(0, this.dataLength);
          // Decode this segment
          const wordStr = decodeWin1252(wordBytes);
          // Add to current line
          this.currentLine += wordStr;
          // Save the completed line
          const line = this.currentLine;
          // Reset for the next word
          this.currentLine = '';
          // Cut off the bytes we just consumed
          data = data.slice(this.dataLength);
          // Determine the length of the NEXT word
          const [descriptorLength, length] = this.decodeLength(data);
          // If the length descriptor spans a chunk boundary,
          // store the descriptor fragment and wait for more data
          if (descriptorLength > data.length) {
            this.lengthDescriptorSegment = data;
          }
          // Save the next word's length
          this.dataLength = length;
          // Slice off the length descriptor bytes
          data = data.slice(descriptorLength);
          // Check for sentence terminator (0x00 byte with length 1)
          if (this.dataLength === 1 && this.bytesEqual(data, NULL_BYTE)) {
            this.dataLength = 0;
            data = data.slice(1); // consume the terminator
          }
          // Push the completed line to the sentence pipe
          this.sentencePipe.push({
            sentence: line,
            hadMore: data.length > 0,
          });
          // Process the sentence
          this.processSentence();
        }
      } else {
        // This is the BEGINNING of a new word — decode its length
        const [descriptorLength, length] = this.decodeLength(data);
        // Store how long the word content is
        this.dataLength = length;
        // Slice off the length descriptor bytes
        data = data.slice(descriptorLength);
        // Check for sentence terminator
        if (this.dataLength === 1 && this.bytesEqual(data, NULL_BYTE)) {
          this.dataLength = 0;
          data = data.slice(1); // consume the terminator
        }
      }
    }
  }

  /**
   * Process sentences from the pipe one at a time.
   * Detects .tag= lines, routes completed packets to registered
   * tag callbacks, and emits 'fatal' on the socket for !fatal replies.
   *
   * Guarded by processingSentencePipe flag to prevent concurrent processing.
   */
  processSentence(): void {
    if (!this.processingSentencePipe) {
      debug('Got asked to process sentence pipe');
      this.processingSentencePipe = true;
      const process = () => {
        if (this.sentencePipe.length > 0) {
          const line = this.sentencePipe.shift()!;
          // !fatal without more data → connection-level fatal error
          // Emit 'fatal' on socket → Connector.onEnd() → close + destroy
          if (!line.hadMore && this.currentReply === '!fatal') {
            this.socket.emit('fatal');
            return;
          }
          debug('Processing line %s', line.sentence);
          // Detect .tag= line → set current tag
          if (/^\.tag=/.test(line.sentence)) {
            this.currentTag = line.sentence.substring(5);
          }
          // Detect reply type (!done, !trap, !fatal, !re, !empty)
          else if (/^!/.test(line.sentence)) {
            // If we already have a tag and receive another reply,
            // send the accumulated data to the tag before switching
            if (this.currentTag) {
              debug(
                'Received another response, sending current data to tag %s',
                this.currentTag
              );
              this.sendTagData(this.currentTag);
            }
            this.currentPacket.push(line.sentence);
            this.currentReply = line.sentence;
          }
          // Regular data line → accumulate
          else {
            this.currentPacket.push(line.sentence);
          }
          // If the pipe is drained and no more data is expected...
          if (this.sentencePipe.length === 0 && this.dataLength === 0) {
            if (!line.hadMore && this.currentTag) {
              debug(
                'No more sentences to process, will send data to tag %s',
                this.currentTag
              );
              this.sendTagData(this.currentTag);
            } else {
              debug('No more sentences and no data to send');
            }
            this.processingSentencePipe = false;
          } else {
            // More sentences in the pipe — recurse
            process();
          }
        } else {
          this.processingSentencePipe = false;
        }
      };
      process();
    }
  }

  /**
   * Send the accumulated packet data to the registered tag callback.
   * Throws UNREGISTEREDTAG if the tag was not found (protocol error).
   */
  private sendTagData(currentTag: string): void {
    const tag = this.tags.get(currentTag);
    if (tag) {
      debug('Sending to tag %s the packet %O', tag.name, this.currentPacket);
      tag.callback(this.currentPacket);
    } else {
      throw new RosException('UNREGISTEREDTAG');
    }
    this.cleanUp();
  }

  /**
   * Reset current packet, tag, and reply state for the next sentence.
   */
  private cleanUp(): void {
    this.currentPacket = [];
    this.currentTag = '';
    this.currentReply = '';
  }

  /**
   * Decode the RouterOS word length from the beginning of the data buffer.
   *
   * RouterOS length encoding (1-5 bytes):
   * - Byte 0 < 0x80        → length = byte 0 (1 byte total)
   * - Byte 0 & 0xC0 = 0x80 → length = ((byte0 & 0x3F) << 8) | byte1 (2 bytes)
   * - Byte 0 & 0xE0 = 0xC0 → length = ((byte0 & 0x1F) << 16) | ... (3 bytes)
   * - Byte 0 & 0xF0 = 0xE0 → length = ((byte0 & 0x0F) << 24) | ... (4 bytes)
   * - Byte 0 = 0xF0         → length = (byte1 << 24) | ... (5 bytes)
   *
   * @param data  Raw bytes (at least 1 byte)
   * @returns     [bytes consumed by length descriptor, decoded content length]
   */
  decodeLength(data: Uint8Array): [number, number] {
    let len: number;
    let idx = 0;
    const b = data[idx++];

    if (b & 0x80) {
      if ((b & 0xc0) === 0x80) {
        len = ((b & 0x3f) << 8) + data[idx++];
      } else {
        if ((b & 0xe0) === 0xc0) {
          len = ((b & 0x1f) << 8) + data[idx++];
          len = (len << 8) + data[idx++];
        } else {
          if ((b & 0xf0) === 0xe0) {
            len = ((b & 0x0f) << 8) + data[idx++];
            len = (len << 8) + data[idx++];
            len = (len << 8) + data[idx++];
          } else {
            len = data[idx++];
            len = (len << 8) + data[idx++];
            len = (len << 8) + data[idx++];
            len = (len << 8) + data[idx++];
          }
        }
      }
    } else {
      len = b;
    }
    return [idx, len];
  }

  /**
   * Compare two Uint8Arrays for equality.
   * Used to detect the NULL_BYTE sentence terminator.
   */
  private bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
}
