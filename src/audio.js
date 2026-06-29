/**
 * Wraps raw PCM buffer inside a WAV file header.
 * @param {ArrayBuffer} pcmBuffer Raw PCM data
 * @param {number} sampleRate e.g. 24000
 * @param {number} numChannels e.g. 1
 * @param {number} bitsPerSample e.g. 16
 * @returns {ArrayBuffer} Completed WAV file buffer
 */
export function pcmToWav(pcmBuffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
    const buffer = new ArrayBuffer(44 + pcmBuffer.byteLength);
    const view = new DataView(buffer);

    // Helpers to write text tags
    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    /* RIFF identifier */
    writeString(0, 'RIFF');
    /* File length (36 + data length) */
    view.setUint32(4, 36 + pcmBuffer.byteLength, true);
    /* RIFF type */
    writeString(8, 'WAVE');
    /* Format chunk identifier */
    writeString(12, 'fmt ');
    /* Format chunk length */
    view.setUint32(16, 16, true);
    /* Sample format (Raw PCM = 1) */
    view.setUint16(20, 1, true);
    /* Channel count */
    view.setUint16(22, numChannels, true);
    /* Sample rate */
    view.setUint32(24, sampleRate, true);
    /* Byte rate = (sampleRate * numChannels * bitsPerSample) / 8 */
    view.setUint32(28, (sampleRate * numChannels * bitsPerSample) / 8, true);
    /* Block align = (numChannels * bitsPerSample) / 8 */
    view.setUint16(32, (numChannels * bitsPerSample) / 8, true);
    /* Bits per sample */
    view.setUint16(34, bitsPerSample, true);
    /* Data chunk identifier */
    writeString(36, 'data');
    /* Data chunk length */
    view.setUint32(40, pcmBuffer.byteLength, true);

    // Copy raw PCM data right after header
    const pcmView = new Uint8Array(pcmBuffer);
    const wavView = new Uint8Array(buffer, 44);
    wavView.set(pcmView);

    return buffer;
}
