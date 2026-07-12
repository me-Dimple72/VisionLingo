// Target languages VisionLingo can translate & pronounce words in.
// `translate` = code used by the MyMemory translation API (en|xx)
// `speech`    = BCP-47 locale used by the browser SpeechSynthesis API
const LANGUAGES = [
  { code: "en", name: "English",    flag: "🇺🇸", translate: "en", speech: "en-US" },
  { code: "es", name: "Spanish",    flag: "🇪🇸", translate: "es", speech: "es-ES" },
  { code: "fr", name: "French",     flag: "🇫🇷", translate: "fr", speech: "fr-FR" },
  { code: "de", name: "German",     flag: "🇩🇪", translate: "de", speech: "de-DE" },
  { code: "it", name: "Italian",    flag: "🇮🇹", translate: "it", speech: "it-IT" },
  { code: "pt", name: "Portuguese", flag: "🇵🇹", translate: "pt", speech: "pt-PT" },
  { code: "ja", name: "Japanese",   flag: "🇯🇵", translate: "ja", speech: "ja-JP" },
  { code: "ko", name: "Korean",     flag: "🇰🇷", translate: "ko", speech: "ko-KR" },
  { code: "zh", name: "Chinese",    flag: "🇨🇳", translate: "zh-CN", speech: "zh-CN" },
  { code: "hi", name: "Hindi",      flag: "🇮🇳", translate: "hi", speech: "hi-IN" },
  { code: "ar", name: "Arabic",     flag: "🇸🇦", translate: "ar", speech: "ar-SA" },
  { code: "ru", name: "Russian",    flag: "🇷🇺", translate: "ru", speech: "ru-RU" },
  { code: "nl", name: "Dutch",      flag: "🇳🇱", translate: "nl", speech: "nl-NL" },
];