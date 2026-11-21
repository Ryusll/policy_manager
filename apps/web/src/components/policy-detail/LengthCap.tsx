import { useI18n } from '../../i18n/useI18n';

/**
 * 길이 상한에 닿았다는 알림(T-224 단계 C 검토) — 입력칸의 maxLength 는 붙여 넣은 글의 뒷부분을 말없이 잘라, 잘린 글이 그대로 저장됐다.
 * 상한은 서버 DTO 와 같은 값을 넘긴다(부칙 제목·본문, 의견, 반려·철회 사유)
 */
export function LengthCap({ value, max }: { value: string; max: number }) {
  const { t } = useI18n();
  if (value.length < max) return null;
  return <p className="text-[11px] text-amber-700 mt-1">{t('bodyWrites.capReached', { max: max.toLocaleString('en-US') })}</p>;
}
