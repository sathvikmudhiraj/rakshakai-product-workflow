export const COPILOT_LANGUAGE_KEY = "rakshakai_copilot_language";

export const COPILOT_LOCALES = {
  en: {
    languageName: "English", title: "Rakshak AI Assistant", readOnly: "READ-ONLY", operationalCopilot: "Operational Copilot", live: "Available", language: "Language", auto: "Auto", suggested: "Suggested questions", context: "Context", you: "You", assistant: "Rakshak AI", send: "Send", close: "Close assistant", placeholder: "Ask about incidents, units, cameras, tracking or SLA", checking: "Checking current operational data…", generated: "Current authorized data checked", error: "Unable to retrieve current operational data.", retry: "Try again", open: "View details", source: "Source", sources: "Sources", updated: "Updated", justNow: "just now", minutesAgo: (n) => `${n} min ago`, hoursAgo: (n) => `${n} hr ago`, unavailable: "Freshness unavailable", welcomeTitle: "How can I help?", welcomeBody: "Ask about incidents, response units, camera health, investigations, tracking, SLA, or escalations.", inputLabel: "Ask Rakshak AI", userLanguage: "English"
  },
  te: {
    languageName: "తెలుగు", title: "Rakshak AI Assistant", readOnly: "చదవడానికి మాత్రమే", operationalCopilot: "ఆపరేషనల్ కోపైలట్", live: "అందుబాటులో ఉంది", language: "భాష", auto: "ఆటో", suggested: "సూచించిన ప్రశ్నలు", context: "సందర్భం", you: "మీరు", assistant: "Rakshak AI", send: "పంపండి", close: "అసిస్టెంట్‌ను మూసివేయండి", placeholder: "ఘటనలు, యూనిట్లు, కెమెరాలు, ట్రాకింగ్ లేదా SLA గురించి అడగండి", checking: "ప్రస్తుత ఆపరేషనల్ డేటాను పరిశీలిస్తోంది…", generated: "ప్రస్తుత అధీకృత డేటా పరిశీలించబడింది", error: "ప్రస్తుత ఆపరేషనల్ డేటాను పొందలేకపోయాము.", retry: "మళ్లీ ప్రయత్నించండి", open: "వివరాలు చూడండి", source: "మూలం", sources: "మూలాలు", updated: "నవీకరణ", justNow: "ఇప్పుడే", minutesAgo: (n) => `${n} నిమిషాల క్రితం`, hoursAgo: (n) => `${n} గంటల క్రితం`, unavailable: "నవీకరణ సమయం అందుబాటులో లేదు", welcomeTitle: "నేను ఎలా సహాయపడగలను?", welcomeBody: "ఘటనలు, response units, camera health, దర్యాప్తులు, tracking, SLA లేదా escalations గురించి అడగండి.", inputLabel: "Rakshak AIని అడగండి", userLanguage: "Telugu"
  },
  hi: {
    languageName: "हिन्दी", title: "Rakshak AI Assistant", readOnly: "केवल पढ़ने के लिए", operationalCopilot: "ऑपरेशनल कोपायलट", live: "उपलब्ध", language: "भाषा", auto: "ऑटो", suggested: "सुझाए गए प्रश्न", context: "संदर्भ", you: "आप", assistant: "Rakshak AI", send: "भेजें", close: "असिस्टेंट बंद करें", placeholder: "घटनाओं, यूनिट, camera, tracking या SLA के बारे में पूछें", checking: "वर्तमान ऑपरेशनल डेटा जाँचा जा रहा है…", generated: "वर्तमान अधिकृत डेटा जाँचा गया", error: "वर्तमान ऑपरेशनल डेटा प्राप्त नहीं हो सका।", retry: "फिर प्रयास करें", open: "विवरण देखें", source: "स्रोत", sources: "स्रोत", updated: "अपडेट", justNow: "अभी", minutesAgo: (n) => `${n} मिनट पहले`, hoursAgo: (n) => `${n} घंटे पहले`, unavailable: "अपडेट समय उपलब्ध नहीं", welcomeTitle: "मैं कैसे सहायता कर सकता हूँ?", welcomeBody: "घटनाओं, response units, camera health, जाँच, tracking, SLA या escalations के बारे में पूछें।", inputLabel: "Rakshak AI से पूछें", userLanguage: "Hindi"
  }
};

const baseSuggestions = {
  en: ["Show critical incidents", "Show available units", "Which cameras need attention?", "Which incidents breached SLA?", "Show pending tracking reviews"],
  te: ["తీవ్ర ఘటనలు చూపించండి", "అందుబాటులో ఉన్న యూనిట్లు చూపించండి", "శ్రద్ధ అవసరమైన కెమెరాలు ఏవి?", "SLA ఉల్లంఘించిన ఘటనలు ఏవి?", "పెండింగ్ ట్రాకింగ్ సమీక్షలు చూపించండి"],
  hi: ["गंभीर घटनाएं दिखाएं", "उपलब्ध यूनिट दिखाएं", "किन camera पर ध्यान चाहिए?", "किन घटनाओं ने SLA का उल्लंघन किया?", "लंबित tracking समीक्षा दिखाएं"]
};

const contextual = {
  "incident-command": {
    en: ["What is pending in this incident?", "Who is responding?", "How much SLA remains?", "Why is this escalated?"],
    te: ["ఈ ఘటనలో ఏమి పెండింగ్‌లో ఉంది?", "ఎవరు స్పందిస్తున్నారు?", "SLA సమయం ఎంత మిగిలింది?", "ఇది ఎందుకు escalate అయింది?"],
    hi: ["इस घटना में क्या लंबित है?", "कौन प्रतिक्रिया दे रहा है?", "कितना SLA समय बचा है?", "यह escalate क्यों हुई?"]
  },
  cctv: {
    en: ["Which cameras need attention?", "Why is this camera unhealthy?", "Any tamper alerts?", "Compare cameras"],
    te: ["ఏ కెమెరాలకు శ్రద్ధ అవసరం?", "ఈ కెమెరా ఆరోగ్యం ఎందుకు బాగోలేదు?", "Tamper alerts ఉన్నాయా?", "కెమెరాలను పోల్చండి"],
    hi: ["किन camera पर ध्यान चाहिए?", "यह camera अस्वस्थ क्यों है?", "कोई tamper alert है?", "camera की तुलना करें"]
  },
  "camera-health": null,
  "unit-assignment": {
    en: ["Which incident is most urgent?", "Which unit is recommended?", "Which incidents still need a unit?", "Are any units offline?"],
    te: ["ఏ ఘటన అత్యవసరం?", "ఏ యూనిట్ సిఫారసు చేయబడింది?", "ఏ ఘటనలకు ఇంకా యూనిట్ అవసరం?", "ఏవైనా యూనిట్లు ఆఫ్‌లైన్‌లో ఉన్నాయా?"],
    hi: ["कौन सी घटना सबसे जरूरी है?", "कौन सी यूनिट अनुशंसित है?", "किन घटनाओं को यूनिट चाहिए?", "क्या कोई यूनिट ऑफ़लाइन है?"]
  },
  "multi-camera-tracking": {
    en: ["Where was this subject last seen?", "Why is this a possible match?", "Show the confirmed track"],
    te: ["ఈ subject చివరిగా ఎక్కడ కనిపించింది?", "ఇది possible match ఎందుకు?", "నిర్ధారించిన track చూపించండి"],
    hi: ["यह subject अंतिम बार कहाँ दिखा?", "यह possible match क्यों है?", "पुष्ट track दिखाएं"]
  }
};
contextual["camera-health"] = contextual.cctv;

export function localeFor(language) { return COPILOT_LOCALES[language] || COPILOT_LOCALES.en; }
export function suggestionsFor(page, language) { return contextual[page]?.[language] || baseSuggestions[language] || baseSuggestions.en; }
export function htmlLanguage(language) { return language === "te" ? "te" : language === "hi" ? "hi" : "en"; }
