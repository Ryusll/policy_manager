/**
 * 음성 읽기 조작 (T-81).
 *
 * 브라우저 내장 음성합성만 쓴다. 규정 본문을 읽어주자고 사내 문서를 외부 TTS로
 * 넘길 이유가 없다.
 *
 * 큐를 직접 돌리는 이유: 긴 글을 한 번에 넘기면 브라우저가 중간에서 끊는다.
 * 문장 단위로 나눠 하나씩 넣고, 끝날 때마다 다음 것을 넣는다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Square, Volume2 } from 'lucide-react';
import { speechSupported } from '../lib/speech';

type Status = 'idle' | 'speaking' | 'paused';

export function SpeechControls({ chunks, label }: { chunks: string[]; label: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const [rate, setRate] = useState(1);
  const [index, setIndex] = useState(0);
  const cursor = useRef(0);
  const supported = speechSupported();

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    cursor.current = 0;
    setIndex(0);
    setStatus('idle');
  }, [supported]);

  // 화면을 벗어나면 계속 읽는 일이 없어야 한다
  useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported]);

  const speakFrom = useCallback(
    (start: number) => {
      if (!supported) return;
      window.speechSynthesis.cancel();
      cursor.current = start;

      const next = () => {
        if (cursor.current >= chunks.length) {
          setStatus('idle');
          cursor.current = 0;
          setIndex(0);
          return;
        }
        const utterance = new SpeechSynthesisUtterance(chunks[cursor.current]);
        utterance.lang = 'ko-KR';
        utterance.rate = rate;
        utterance.onend = () => {
          cursor.current += 1;
          setIndex(cursor.current);
          next();
        };
        // 읽기 실패로 멈추면 사용자는 이유를 알 수 없다. 조용히 다음으로 넘긴다.
        utterance.onerror = () => {
          cursor.current += 1;
          setIndex(cursor.current);
          next();
        };
        window.speechSynthesis.speak(utterance);
      };

      setStatus('speaking');
      next();
    },
    [chunks, rate, supported],
  );

  if (!supported) {
    return (
      <p className="text-xs text-gray-500">
        이 브라우저는 음성 읽기를 지원하지 않습니다. 크롬·엣지·사파리 최신 버전에서 사용하세요.
      </p>
    );
  }

  if (!chunks.length) {
    return <p className="text-xs text-gray-500">읽을 본문이 없습니다.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
        <Volume2 size={14} /> 음성 읽기
      </span>

      {status === 'speaking' ? (
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => {
            window.speechSynthesis.pause();
            setStatus('paused');
          }}
        >
          <Pause size={13} /> 일시정지
        </button>
      ) : (
        <button
          type="button"
          className="btn-primary text-xs"
          onClick={() => {
            if (status === 'paused') {
              window.speechSynthesis.resume();
              setStatus('speaking');
            } else {
              speakFrom(0);
            }
          }}
        >
          <Play size={13} /> {status === 'paused' ? '이어 읽기' : '읽기'}
        </button>
      )}

      <button type="button" className="btn-secondary text-xs" onClick={stop} disabled={status === 'idle'}>
        <Square size={13} /> 정지
      </button>

      <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
        속도
        <select
          className="input text-xs w-auto py-1"
          value={rate}
          onChange={(e) => {
            const next = Number(e.target.value);
            setRate(next);
            // 읽는 중이면 지금 문장부터 새 속도로 다시 시작한다(중간부터 바꿀 방법이 없다)
            if (status !== 'idle') speakFrom(cursor.current);
          }}
        >
          {[0.8, 1, 1.25, 1.5].map((r) => (
            <option key={r} value={r}>
              {r}x
            </option>
          ))}
        </select>
      </label>

      <span className="text-[11px] text-gray-500 tabular-nums" aria-live="polite">
        {status === 'idle' ? `${chunks.length}문단 · ${label}` : `${Math.min(index + 1, chunks.length)}/${chunks.length}`}
      </span>
    </div>
  );
}
