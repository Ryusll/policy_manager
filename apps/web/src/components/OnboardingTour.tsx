import { useState, useLayoutEffect, useId, useMemo } from 'react';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';

interface Step {
  targetId: string;
  titleKey: string;
  descKey: string;
  position: 'right' | 'bottom' | 'left' | 'top';
  /** 대상 요소 바깥으로 하이라이트를 넓히는 px. 0이면 요소 크기에 딱 맞춘다. */
  padding: number;
}

// 네비게이션 탭은 이웃 탭·헤더 윗줄과 바로 맞닿아 있어서, 여백을 주면 옆 요소까지 번져 보인다
const STEP_DEFS: Step[] = [
  { targetId: 'nav-dashboard', titleKey: 'tour.step1.title', descKey: 'tour.step1.desc', position: 'right', padding: 0 },
  { targetId: 'nav-policies', titleKey: 'tour.step2.title', descKey: 'tour.step2.desc', position: 'right', padding: 0 },
  { targetId: 'nav-search', titleKey: 'tour.step3.title', descKey: 'tour.step3.desc', position: 'right', padding: 0 },
  { targetId: 'nav-variables', titleKey: 'tour.step4.title', descKey: 'tour.step4.desc', position: 'right', padding: 0 },
  {
    targetId: 'tour-user-info',
    titleKey: 'tour.step5.title',
    descKey: 'tour.step5.desc',
    position: 'bottom',
    padding: 4,
  },
];

const STORAGE_KEY = 'policy_manager_tour_done';

interface Props {
  onFinish: () => void;
}

export default function OnboardingTour({ onFinish }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const maskId = useId().replace(/:/g, '');

  const steps = useMemo(
    () =>
      STEP_DEFS.map((d) => ({
        ...d,
        title: t(d.titleKey),
        description: t(d.descKey),
      })),
    [t],
  );

  const finish = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    onFinish();
  };

  const current = steps[step];
  const TOOLTIP_W = 300;
  const padding = current.padding;
  // 여백이 없으면 대상 요소의 모서리(직각)를 그대로 따라간다
  const radius = padding > 0 ? 6 : 0;
  const STROKE = 2;

  useLayoutEffect(() => {
    let cancelled = false;
    let attempt = 0;

    const measure = () => {
      if (cancelled) return;
      const def = STEP_DEFS[step];
      const el = document.getElementById(def.targetId);
      if (el) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        const rect = el.getBoundingClientRect();
        if (rect.width >= 1 && rect.height >= 1) {
          setBox(rect);
          return;
        }
      }
      attempt += 1;
      if (attempt < 24) {
        window.setTimeout(measure, 40);
      } else {
        setBox(null);
      }
    };

    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
    };
  }, [step]);

  const getTooltipStyle = (): React.CSSProperties => {
    if (!box) {
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: TOOLTIP_W,
        maxWidth: 'calc(100vw - 24px)',
      };
    }
    const pos = current.position;
    const margin = 12;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;

    if (pos === 'right') {
      let left = box.right + margin;
      if (left + TOOLTIP_W > vw - 8) {
        left = Math.max(8, box.left - TOOLTIP_W - margin);
      }
      return {
        top: Math.max(8, Math.min(window.innerHeight - 200, box.top + box.height / 2 - 72)),
        left,
        width: TOOLTIP_W,
        maxWidth: 'calc(100vw - 24px)',
      };
    }
    if (pos === 'bottom') {
      let left = box.left + box.width / 2 - TOOLTIP_W / 2;
      left = Math.max(8, Math.min(left, vw - TOOLTIP_W - 8));
      return {
        top: box.bottom + margin,
        left,
        width: TOOLTIP_W,
        maxWidth: 'calc(100vw - 24px)',
      };
    }
    if (pos === 'left') {
      return {
        top: Math.max(8, box.top + box.height / 2 - 72),
        left: Math.max(8, box.left - TOOLTIP_W - margin),
        width: TOOLTIP_W,
      };
    }
    return {
      top: Math.max(8, box.top - margin),
      left: Math.max(8, box.left + box.width / 2 - TOOLTIP_W / 2),
      width: TOOLTIP_W,
      transform: 'translateY(-100%)',
    };
  };

  return (
    <>
      <div className="fixed inset-0 z-[200] pointer-events-none">
        {box ? (
          <svg width="100%" height="100%" className="absolute inset-0" aria-hidden>
            <defs>
              <mask id={maskId}>
                <rect width="100%" height="100%" fill="white" />
                <rect
                  x={box.left - padding}
                  y={box.top - padding}
                  width={box.width + padding * 2}
                  height={box.height + padding * 2}
                  rx={radius}
                  fill="black"
                />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask={`url(#${maskId})`} />
            {/* SVG 테두리는 선 중앙이 경계라 바깥으로 절반 삐져나온다 — 안쪽으로 당겨서 바깥 가장자리를 구멍과 일치시킨다 */}
            <rect
              x={box.left - padding + STROKE / 2}
              y={box.top - padding + STROKE / 2}
              width={box.width + padding * 2 - STROKE}
              height={box.height + padding * 2 - STROKE}
              rx={Math.max(0, radius - STROKE / 2)}
              fill="none"
              stroke="#d4a574"
              strokeWidth={STROKE}
            />
          </svg>
        ) : (
          <div className="absolute inset-0 bg-black/55" />
        )}
      </div>

      {/* 페이지 클릭 차단 (툴팁 z-210보다 아래) */}
      <div className="fixed inset-0 z-[205] cursor-default" aria-hidden onMouseDown={(e) => e.preventDefault()} />

        <div
        className="fixed z-[210] bg-white border-2 border-navy-800 shadow-2xl pointer-events-auto max-h-[90vh] overflow-y-auto"
          style={getTooltipStyle()}
        role="dialog"
        aria-labelledby="tour-step-title"
        >
          <div className="h-1 bg-gray-100">
            <div
              className="h-1 bg-navy-800 transition-all duration-300"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
            />
          </div>

          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">
              {t('tour.progress', { cur: step + 1, total: steps.length })}
            </span>
            <button type="button" onClick={finish} className="p-0.5 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            </div>

          <div id="tour-step-title" className="mb-1 font-bold text-navy-800 text-sm">
            {current.title}
          </div>
            <p className="text-xs text-gray-600 leading-relaxed mb-4">{current.description}</p>

            <div className="flex items-center gap-2">
              {step > 0 && (
                <button
                type="button"
                  onClick={() => setStep((s) => s - 1)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 px-2 py-1 border border-gray-300 rounded"
                >
                <ChevronLeft size={12} /> {t('tour.prev')}
                </button>
              )}
              <div className="flex-1" />
              <div className="flex gap-1">
              {steps.map((_, i) => (
                  <button
                    key={i}
                  type="button"
                    onClick={() => setStep(i)}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${i === step ? 'bg-navy-800' : 'bg-gray-300'}`}
                  />
                ))}
              </div>
              <div className="flex-1" />
            {step < steps.length - 1 ? (
                <button
                type="button"
                  onClick={() => setStep((s) => s + 1)}
                  className="flex items-center gap-1 text-xs bg-navy-800 text-white px-3 py-1.5 rounded hover:bg-navy-700"
                >
                {t('tour.next')} <ChevronRight size={12} />
                </button>
              ) : (
                <button
                type="button"
                  onClick={finish}
                  className="text-xs bg-gold-500 text-white px-3 py-1.5 rounded hover:bg-gold-400"
                >
                {t('tour.finish')}
                </button>
              )}
            </div>
          </div>

          <div className="border-t border-gray-100 px-4 py-2">
          <button type="button" onClick={finish} className="text-xs text-gray-400 hover:text-gray-600 w-full text-center">
            {t('tour.skip')}
            </button>
          </div>
        </div>
    </>
  );
}

export { STORAGE_KEY };
