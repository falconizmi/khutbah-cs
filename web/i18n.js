/**
 * Trilingual i18n dictionary for the Khutbah CS web app.
 * Languages: cs (Czech), ar (Arabic), en (English).
 */

const I18N = {
  cs: {
    page_title: "Překladač pátečních kázání",
    subtitle: "Online nástroj pro překlad arabských kázání do češtiny s ověřením veršů z Koránu a hadísů",
    // API Key bar
    api_key_label: "Klíč Gemini AI (volitelné)",
    api_key_placeholder: "AIzaSy...",
    remember_key: "Zapamatovat v tomto prohlížeči",
    forget_key: "Zapomenout klíč",
    key_ready: "🔑 Klíč připraven",
    key_settings: "[Nastavení]",
    how_to_get_key: "Jak získat bezplatný API klíč?",
    how_to_key_step1: "Přejděte na console.cloud.google.com a vytvořte nový projekt.",
    how_to_key_step2: "Povolte Gemini API (v sekci Library vyhledejte „Generative Language“).",
    how_to_key_step3: "Vytvořte API klíč v sekci Credentials — zkopírujte ho sem.",
    // Controls
    friday_date_label: "Datum pátečního kázání",
    date_preview: "Předpokládaný hlavičkový datum:",
    output_versions_label: "Verze výstupu",
    opt_all_three: "Všechny 3 verze — Porovnat plné, zkrácené a stručné",
    opt_full_condensed: "Plné + Zkrácené (~4–5 min / 1 A4 stránka)",
    opt_full_brief: "Plné + Stručné (~2–3 min)",
    opt_full_only: "Pouze plné kázání (~8–10 min)",
    ai_model_label: "Model AI",
    // Buttons
    check_scripture: "Ověřit verše z Koránu a hadísů",
    translate_khutbah: "Přeložit kázání",
    upload_txt: "Nahrát .txt soubor",
    arabic_input_label: "Arabský text kázání",
    // Arabic textarea placeholder
    arabic_placeholder_cs: "Zde vložte arabský text pátečního kázání (khutba)...\n\nNebo přetáhněte .txt soubor sem.",
    // Progress steps
    step_scripture: "1. Ověření veršů",
    step_translation: "2. Překlad do češtiny",
    step_polish: "3. Úprava gramatiky a stylu",
    step_condensing: "4. Zkracování",
    step_qa: "5. Koneční kontrola kvality",
    // Output tabs
    tab_full: "Plné znění / Full",
    tab_condensed: "Zkrácená (~4 min) / Condensed",
    tab_brief: "Stručná (~2 min) / Brief",
    // Action bar
    copy_text: "Kopírovat text",
    download_txt: "Stáhnout .txt",
    download_md: "Stáhnout .md",
    print_a4: "Tisknout A4 pro mešitu",
    // Dataset indicator
    dataset_ready: "Dataset připraven",
    verses_count: "veršů",
    hadiths_count: "hadísů",
    sermons_count: "kázání v archivu",
  },
  ar: {
    page_title: "مترجم خطب الجمعة",
    subtitle: "أداة عبر الإنترنت لترجمة الخطب العربية إلى التشيكية مع التحقق من الآيات القرآنية والأحاديث النبوية",
    // API Key bar
    api_key_label: "مفتاح Gemini AI (اختياري)",
    api_key_placeholder: "AIzaSy...",
    remember_key: "تذكر في هذا المتصفح",
    forget_key: "نسيان المفتاح",
    key_ready: "🔑 المفتاح جاهز",
    key_settings: "[الإعدادات]",
    how_to_get_key: "كيف تحصل على مفتاح API مجاني؟",
    how_to_key_step1: "انتقل إلى console.cloud.google.com وأنشئ مشروعًا جديدًا.",
    how_to_key_step2: "فعّل واجهة Gemini API (ابحث عن „Generative Language“ في قسم Library).",
    how_to_key_step3: "أنشئ مفتاح API في قسم Credentials — انسخه هنا.",
    // Controls
    friday_date_label: "تاريخ خطبة الجمعة",
    date_preview: "التاريخ المتوقع:",
    output_versions_label: "إصدارات المخرجات",
    opt_all_three: "جميع الإصدارات الثلاثة — مقارنة كاملة ومختصرة وموجزة",
    opt_full_condensed: "كاملة + مختصرة (~4–5 دقائق / صفحة A4 واحدة)",
    opt_full_brief: "كاملة + موجزة (~2–3 دقائق)",
    opt_full_only: "الخطبة الكاملة فقط (~8–10 دقائق)",
    ai_model_label: "نموذج الذكاء الاصطناعي",
    // Buttons
    check_scripture: "فحص الآيات والأحاديث",
    translate_khutbah: "ترجمة الخطبة",
    upload_txt: "تحميل ملف .txt",
    arabic_input_label: "النص العربي للخطبة",
    // Arabic textarea placeholder
    arabic_placeholder_ar: "الصق هنا نص خطبة الجمعة العربية...\n\nأو اسحب ملف .txt وأفلته هنا.",
    // Progress steps
    step_scripture: "١. التحقق من الآيات",
    step_translation: "٢. الترجمة إلى التشيكية",
    step_polish: "٣. مراجعة القواعد والأسلوب",
    step_condensing: "٤. الاختصار",
    step_qa: "٥. الفحص النهائي للجودة",
    // Output tabs
    tab_full: "النص الكامل / Full",
    tab_condensed: "مختصرة (~4 دقائق) / Condensed",
    tab_brief: "موجزة (~2 دقيقة) / Brief",
    // Action bar
    copy_text: "نسخ النص",
    download_txt: "تحميل .txt",
    download_md: "تحميل .md",
    print_a4: "طباعة A4 للمسجد",
    // Dataset indicator
    dataset_ready: "البيانات جاهزة",
    verses_count: "آيات",
    hadiths_count: "أحاديث نبوية",
    sermons_count: "خطب في الأرشيف",
  },
  en: {
    page_title: "Friday Khutbah Translator",
    subtitle: "Online tool for translating Arabic Friday sermons into Czech with Quran & Hadith verification",
    // API Key bar
    api_key_label: "Gemini AI API Key (optional)",
    api_key_placeholder: "AIzaSy...",
    remember_key: "Remember in this browser",
    forget_key: "Forget key",
    key_ready: "🔑 API Key Ready",
    key_settings: "[Settings]",
    how_to_get_key: "How to get a free API key?",
    how_to_key_step1: "Go to console.cloud.google.com and create a new project.",
    how_to_key_step2: "Enable the Gemini API (search for „Generative Language“ in Library).",
    how_to_key_step3: "Create an API Key under Credentials — copy it here.",
    // Controls
    friday_date_label: "Friday Sermon Date",
    date_preview: "Expected header date:",
    output_versions_label: "Output Versions",
    opt_all_three: "All 3 Versions — Compare Full, Condensed & Brief",
    opt_full_condensed: "Full + Condensed (~4–5 min / 1 A4 page)",
    opt_full_brief: "Full + Brief (~2–3 min)",
    opt_full_only: "Full Sermon Only (~8–10 min)",
    ai_model_label: "AI Model",
    // Buttons
    check_scripture: "Check Quran & Hadith Quotes",
    translate_khutbah: "Translate Khutbah",
    upload_txt: "Upload .txt File",
    arabic_input_label: "Arabic Sermon Text",
    // Arabic textarea placeholder
    arabic_placeholder_en: "Paste your Arabic Friday sermon (khutbah) text here...\n\nOr drag and drop a .txt file onto this area.",
    // Progress steps
    step_scripture: "1. Scripture Match",
    step_translation: "2. Czech Translation",
    step_polish: "3. Grammar & Cadence Polish",
    step_condensing: "4. Condensing",
    step_qa: "5. Final QA Check",
    // Output tabs
    tab_full: "Plné znění / Full",
    tab_condensed: "Zkrácená (~4 min) / Condensed",
    tab_brief: "Stručná (~2 min) / Brief",
    // Action bar
    copy_text: "Copy Text",
    download_txt: "Download .txt",
    download_md: "Download .md",
    print_a4: "Print A4 Mosque Sheet",
    // Dataset indicator
    dataset_ready: "Dataset ready",
    verses_count: "verses",
    hadiths_count: "hadiths",
    sermons_count: "archive sermons",
  },
};

/** Get the current active language (persisted in localStorage, default cs). */
function getLang() {
  return localStorage.getItem("khutbah_lang") || "cs";
}

/** Set the active language and persist it. */
function setLang(lang) {
  if (!I18N[lang]) return;
  localStorage.setItem("khutbah_lang", lang);
  applyLanguage(lang);
}

/** Translate all elements with data-i18n attributes. */
function t(key, lang) {
  const l = lang || getLang();
  return I18N[l]?.[key] ?? I18N.cs?.[key] ?? key;
}

/** Apply language to the entire DOM: update text content, placeholders, html dir/lang. */
function applyLanguage(lang) {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    const val = t(key, lang);
    if (el.hasAttribute("placeholder")) {
      el.setAttribute("placeholder", val);
    } else if (el.tagName === "TITLE") {
      el.textContent = val;
    } else {
      el.textContent = val;
    }
  });

  // RTL for Arabic, LTR for others
  const html = document.documentElement;
  if (lang === "ar") {
    html.setAttribute("dir", "rtl");
    html.setAttribute("lang", "ar");
  } else {
    html.setAttribute("dir", lang === "cs" ? "ltr" : "ltr");
    html.setAttribute("lang", lang);
  }

  // Czech sermon output card always LTR + cs
  const csCard = document.getElementById("sermon-output-card");
  if (csCard) {
    csCard.setAttribute("dir", "ltr");
    csCard.setAttribute("lang", "cs");
  }

  // Update active state on language switcher buttons
  document.querySelectorAll(".lang-btn").forEach(btn => {
    const btnLang = btn.getAttribute("onclick")?.match(/setLang\('(\w+)'\)/)?.[1];
    btn.classList.toggle("active", btnLang === lang);
  });

  // Re-render API key status line in new language (it uses t() for translated strings)
  if (typeof updateApiKeyUI === "function") updateApiKeyUI();
}
