import React, { createContext, useContext, useState } from 'react'
import { translations } from '@/i18n/translations'

export type Lang = 'en' | 'bg'

interface LanguageContextType {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string) => string
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'bg',
  setLang: () => {},
  t: (k) => k,
})

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    return (localStorage.getItem('fp_lang') as Lang) ?? 'bg'
  })

  const setLang = (l: Lang) => {
    setLangState(l)
    localStorage.setItem('fp_lang', l)
  }

  const t = (key: string): string =>
    translations[lang][key] ?? translations['en'][key] ?? key

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export const useLanguage = () => useContext(LanguageContext)
