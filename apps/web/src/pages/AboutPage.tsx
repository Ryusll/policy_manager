import { useI18n } from '../i18n/useI18n';

export default function AboutPage() {
  const { t } = useI18n();
  const missionItems = t('about.mission.items').split('\n').filter(Boolean);
  const productItems = t('about.product.items').split('\n').filter(Boolean);
  const principleItems = t('about.principles.items').split('\n').filter(Boolean);

  return (
    <div className="max-w-4xl space-y-8">
      <header className="border-b border-gray-200 pb-4">
        <h1 className="text-xl font-bold text-navy-900">{t('about.title')}</h1>
        <p className="text-sm text-gray-600 mt-2 leading-relaxed">{t('about.lead')}</p>
      </header>

      <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-navy-800 uppercase tracking-wide">{t('about.story.title')}</h2>
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-navy-900">{t('about.story.astrumTitle')}</p>
            <p className="text-sm text-gray-700 leading-relaxed">{t('about.story.astrumBody')}</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-navy-900">{t('about.story.vedaTitle')}</p>
            <p className="text-sm text-gray-700 leading-relaxed">{t('about.story.vedaBody')}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="border border-gray-200 rounded-lg p-5 space-y-3">
          <h2 className="text-sm font-semibold text-navy-800 uppercase tracking-wide">{t('about.mission.title')}</h2>
          <p className="text-sm text-gray-700 leading-relaxed">{t('about.mission.body')}</p>
          <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
            {missionItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="border border-gray-200 rounded-lg p-5 space-y-3">
          <h2 className="text-sm font-semibold text-navy-800 uppercase tracking-wide">{t('about.product.title')}</h2>
          <p className="text-sm text-gray-700 leading-relaxed">{t('about.product.body')}</p>
          <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
            {productItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="border border-gray-200 rounded-lg p-5 space-y-3">
        <h2 className="text-sm font-semibold text-navy-800 uppercase tracking-wide">{t('about.principles.title')}</h2>
        <p className="text-sm text-gray-700 leading-relaxed">{t('about.principles.body')}</p>
        <ul className="grid gap-2 md:grid-cols-2">
          {principleItems.map((item) => (
            <li key={item} className="text-sm text-gray-700 bg-gray-50 rounded px-3 py-2 border border-gray-100">
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-navy-50 border border-navy-100 rounded p-5 space-y-2">
        <h2 className="text-sm font-semibold text-navy-800">{t('about.contact.title')}</h2>
        <p className="text-sm text-gray-700">{t('about.contact.body')}</p>
        <a
          href={'mailto:' + t('about.contactEmail')}
          className="text-sm text-navy-700 font-medium hover:underline"
        >
          {t('about.contactEmail')}
        </a>
      </section>
    </div>
  );
}
