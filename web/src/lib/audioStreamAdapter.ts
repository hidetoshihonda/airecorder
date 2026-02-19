"use client";

import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";

/**
 * Float32Array (-1.0 ~ 1.0) を Int16Array (-32768 ~ 32767) に変換する。
 * Azure Speech SDK の PushAudioInputStream が要求する 16-bit PCM フォーマットに合わせる。
 */
function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

/**
 * Issue #167: MediaStream → Azure Speech SDK PushAudioInputStream 変換アダプター
 *
 * Web Audio API の AudioContext を sampleRate: 16000 で作成し、
 * ScriptProcessorNode で Float32 → Int16 変換しながら
 * PushAudioInputStream に PCM データを書き込む。
 *
 * Azure Speech SDK は 16kHz / 16bit / mono PCM を要求するため、
 * AudioContext({ sampleRate: 16000 }) でブラウザに自動リサンプリングさせる。
 *
 * @param mediaStream - getUserMedia / getDisplayMedia が返す MediaStream
 * @returns pushStream (Azure SDK 入力) と cleanup 関数
 */
export function createPushStreamFromMediaStream(
  mediaStream: MediaStream
): { pushStream: SpeechSDK.PushAudioInputStream; cleanup: () => void } {
  // 16kHz / 16bit / mono フォーマットを指定
  const format = SpeechSDK.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
  const pushStream = SpeechSDK.AudioInputStream.createPushStream(format);

  // AudioContext を 16kHz で作成（ブラウザが自動リサンプリング）
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(mediaStream);

  // ScriptProcessorNode: バッファサイズ 4096, 入力1ch, 出力1ch
  // ※ ScriptProcessorNode は deprecated だが全ブラウザで安定動作する
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (event: AudioProcessingEvent) => {
    const float32Data = event.inputBuffer.getChannelData(0);
    const int16Data = float32ToInt16(float32Data);
    pushStream.write(int16Data.buffer as ArrayBuffer);
  };

  source.connect(processor);
  // ScriptProcessorNode は destination に接続しないと onaudioprocess が発火しない
  processor.connect(audioContext.destination);

  const cleanup = () => {
    try {
      processor.disconnect();
      source.disconnect();
    } catch {
      // disconnect 時のエラーは無視（既に切断済みの場合）
    }
    audioContext.close().catch(() => {});
    pushStream.close();
  };

  return { pushStream, cleanup };
}
