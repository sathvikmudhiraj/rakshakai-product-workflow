const SUPPORTED_LANGUAGES = new Set(["auto", "en", "te", "hi"]);

const ROMAN_TELUGU = [
  /\b(?:ipudu|ippudu|eni|enni|entha\s*mandi|enta\s*mandi|officerlu|evaru|unnaru|unnaro|unaru|unar|chepu)\b/i,
  /\b(?:chupinchu|chupinchandi|choopinchu|choopinchandi|cheppu|cheppandi|ekkada|enti|ela\s+undi|evariki|ayyindi|unda|unnayi|kavali|chey|cheyyi)\b/i,
  /\b(?:ni|ki)\s+(?:assign|close|resolve|delete|confirm|reject)\b/i
];
const ROMAN_HINDI = [
  /\b(?:dikhao|dikhaiye|batao|bataye|kahan|kya\s+hai|kis(?:ko|\s+unit)|karo|kijiye|hai|ka\s+status|ko\s+assign)\b/i
];

function selectedLanguage(value) {
  const language = String(value || "auto").toLowerCase();
  return SUPPORTED_LANGUAGES.has(language) ? language : "auto";
}

function detectLanguage(query, previousLanguage = "en") {
  const text = String(query || "");
  if (/[\u0C00-\u0C7F]/u.test(text)) return { language: "te", confidence: "high", signal: "telugu-script" };
  if (/[\u0900-\u097F]/u.test(text)) return { language: "hi", confidence: "high", signal: "devanagari-script" };
  const teluguScore = ROMAN_TELUGU.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
  const hindiScore = ROMAN_HINDI.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
  if (teluguScore > hindiScore) return { language: "te", confidence: "medium", signal: "roman-telugu" };
  if (hindiScore > teluguScore) return { language: "hi", confidence: "medium", signal: "roman-hindi" };
  if (/\b(?:show|what|which|where|why|how|give|list|compare|status|health|available|critical|incidents?|cameras?|units?|tracking|officers?|police|stations?|ps|summary)\b/i.test(text)) return { language: "en", confidence: "medium", signal: "english-operational" };
  const recent = ["en", "te", "hi"].includes(previousLanguage) ? previousLanguage : "en";
  return { language: recent, confidence: "low", signal: "conversation-fallback" };
}

const replacements = [
  [/తీవ్ర|క్రిటికల్|गंभीर|क्रिटिकल/gu, " critical "],
  [/ఘటనలు|ఘటన|घटनाएं|घटना|घटनाओं/gu, " incidents "],
  [/చూపించు|చూపించండి|చూపించు|దिखाओ|दिखाइए/gu, " show "],
  [/స్థితి|स्थिति/gu, " status "],
  [/చెప్పు|చెప్పండి|बताओ|बताइए/gu, " show "],
  [/కెమెరా\s*ఆరోగ్యం|कैमरा\s*स्थिति|कैमरा\s*हेल्थ/gu, " camera health "],
  [/అందుబాటులో\s*ఉన్న\s*యూనిట్లు|उपलब्ध\s*यूनिट/gu, " available units "],
  [/ఉల్లంఘన|उल्लंघन/gu, " breach "],
  [/ఎక్కడ|कहाँ/gu, " where "],
  [/ఎవరికి\s*అసైన్|किस\s*यूनिट\s*को\s*असाइन/gu, " assigned unit "],
  [/దర్యాప్తు|जांच/gu, " investigation "],
  [/ట్రాకింగ్|ट्रैकिंग/gu, " tracking "],
  [/మూసివేయి|बंद\s*करो/gu, " close "],
  [/తొలగించు|हटाओ|डिलीट\s*करो/gu, " delete "],
  [/నిర్ధారించు|पुष्टि\s*करो/gu, " confirm "],
  [/తిరస్కరించు|अस्वीकार\s*करो/gu, " reject "]
];

function normalizeQuery(query) {
  let canonical = String(query || "").normalize("NFKC");
  canonical = canonical
    .replace(/పోలీస్\s*స్టేషన్|పోలీసు\s*స్టేషన్|పోలిస్\s*స్టేషన్|పోలీస్\s*స్టేషను/gu, " police station ")
    .replace(/పోలీస్|పోలీసు|పోలిస్/gu, " police ")
    .replace(/ఖాతాలు|అకౌంట్లు|అకౌంట్స్/gu, " accounts ")
    .replace(/మొత్తం/gu, " total ")
    .replace(/యూనిట్లు|యూనిట్స్|యూనిట్/gu, " units ")
    .replace(/ఇనాక్టివ్/gu, " inactive ")
    .replace(/యాక్టివ్/gu, " active ")
    .replace(/ఆఫీసర్[‌\s]*లు|ఆఫీసర్లు|ఆఫీసర్స్|అధికారులు|పోలీసులు/gu, " officers ")
    .replace(/ఎంత\s*మంది|ఎన్ని|ఎని/gu, " how many ")
    .replace(/ఎవరు/gu, " who ")
    .replace(/ఉన్నారో|ఉన్నారు|ఉనారో/gu, " present ")
    .replace(/పటాన్[‌\s]*చెరువు|పటాన్[‌\s]*చెరు|పటాన్చెరు/gu, " patancheru ")
    .replace(/రామచంద్రపురం|రామచంద్రపురము/gu, " ramachandrapuram ")
    .replace(/బీహెచ్[‌\s]*ఈఎల్|బీహెచ్ఈఎల్|బీహెచ్ఎల్|బిహెచ్ఎల్/gu, " bhel ")
    .replace(/అందుబాటులో/gu, " available ")
    .replace(/డ్యూటీలో|విధుల్లో/gu, " on duty ")
    .replace(/ఇప్పుడు/gu, " now ")
    .replace(/(?:^|\s)లో(?=\s|$)/gu, " lo ")
    .replace(/\b(?:officerlu|officerslu)\b/gi, " officers ")
    .replace(/\b(?:unitlu|unitslu)\b/gi, " units ")
    .replace(/\b(?:eni|enni|entha\s*mandi|enta\s*mandi)\b/gi, " how many ")
    .replace(/\b(?:evaru|evarunnaru)\b/gi, " who ")
    .replace(/\b(?:unnaro|unnaru|unaru|unar)\b/gi, " present ")
    .replace(/\b(?:ipudu|ippudu)\b/gi, " now ")
    .replace(/\bps\b(?![-_])/gi, " police station ")
    .replace(/\baccounts?(?:lu)?\b/gi, " accounts ");
  for (const [pattern, replacement] of replacements) canonical = canonical.replace(pattern, replacement);
  canonical = canonical
    .replace(/\b(?:chupinchu|chupinchandi|choopinchu|choopinchandi|dikhao|dikhaiye)\b/gi, " show ")
    .replace(/\b(?:chepu|cheppu|cheppandi|batao|bataye)\b/gi, " show ")
    .replace(/\b(?:ekkada|kahan(?:\s+hai)?)\b/gi, " where ")
    .replace(/\b(?:enti|kya\s+hai)\b/gi, " status ")
    .replace(/\b(?:ela\s+undi)\b/gi, " health ")
    .replace(/\b(?:evariki\s+assign\s+ayyindi|kis\s+unit\s+ko\s+assign(?:ed)?\s+hai)\b/gi, " assigned unit ")
    .replace(/\b(?:unda|hai)\b/gi, " ")
    .replace(/\b(?:chey|cheyyi|karo|kijiye)\b/gi, " execute ")
    .replace(/\s+/g, " ")
    .trim();
  return canonical;
}

const MULTILINGUAL_WRITE_PATTERN = /(?:\b(?:assign|reassign|release|resolve|close|delete|remove|acknowledge|confirm|reject|change|disable|enable|create|update|edit|set)\b(?:\s+(?:chey|cheyyi|karo|kijiye|करो|कीजिए|చేయి|చేయండి))?|(?:అసైన్|మూసివేయి|పరిష్కరించు|తొలగించు|నిర్ధారించు|తిరస్కరించు|మార్చు|నిలిపివేయి|సృష్టించు|నవీకరించు)|(?:असाइन|पुनः\s*असाइन|रिज़ॉल्व|बंद\s*करो|हटाओ|डिलीट|स्वीकार|पुष्टि|अस्वीकार|बदलो|अक्षम|बनाओ|अपडेट))/iu;
const SENSITIVE_REQUEST_PATTERN = /(?:password|passcode|secret|token|credential|api[_ -]?key|jwt|rtsp(?:\s+(?:url|credential|password))?|పాస్‌వర్డ్|రహస్యం|టోకెన్|క్రెడెన్షియల్|पासवर्ड|गुप्त|टोकन|क्रेडेंशियल)/iu;
const INJECTION_PATTERN = /(?:ignore\s+(?:all\s+)?previous|bypass\s+(?:rules|safety)|write\s+to\s+(?:the\s+)?database|run\s+sql|మునుపటి\s+నియమాలను\s+విస్మరించు|डेटाबेस\s+में\s+लिखो|पिछले\s+निर्देश.*अनदेखा)/iu;

const exact = {
  te: {
    "I can show operational information but cannot modify RakshakAI data. Use the relevant authorized operational page to perform that action.": "నేను ఆపరేషనల్ సమాచారాన్ని చూపగలను, కానీ RakshakAI డేటాను మార్చలేను. ఆ చర్యను సంబంధిత అధీకృత ఆపరేషనల్ పేజీలో చేయాలి.",
    "I can't provide passwords, tokens, credentials, private URLs, or other protected configuration.": "పాస్‌వర్డ్‌లు, టోకెన్‌లు, క్రెడెన్షియల్స్, ప్రైవేట్ URLలు లేదా ఇతర రక్షిత కాన్ఫిగరేషన్‌ను నేను అందించలేను.",
    "I can only use approved read-only RakshakAI information tools. I cannot bypass safety rules, execute SQL, or write to operational data.": "నేను అధీకృత read-only RakshakAI సమాచార సాధనాలను మాత్రమే ఉపయోగించగలను. భద్రతా నియమాలను దాటడం, SQL అమలు చేయడం లేదా ఆపరేషనల్ డేటాను మార్చడం సాధ్యం కాదు.",
    "I couldn't confidently identify the operational request. Try asking about an incident ID, camera, unit, SLA, or tracking session.": "మీ ఆపరేషనల్ ప్రశ్నను స్పష్టంగా గుర్తించలేకపోయాను. Incident ID, camera, unit, SLA లేదా tracking session గురించి అడగండి.",
    "No matching active incidents were found.": "సరిపోలే యాక్టివ్ ఘటనలు కనబడలేదు.",
    "No current SLA breaches are recorded.": "ప్రస్తుతం SLA ఉల్లంఘనలు నమోదు కాలేదు.",
    "No response units are currently recorded as available.": "ప్రస్తుతం అందుబాటులో ఉన్న response units నమోదు కాలేదు.",
    "No matching unhealthy cameras are currently recorded.": "శ్రద్ధ అవసరమైన కెమెరాలు ప్రస్తుతం నమోదు కాలేదు.",
    "This is a candidate association, not an automatic identity claim. Human verification is still required.": "ఇది candidate association మాత్రమే; స్వయంచాలక గుర్తింపు నిర్ధారణ కాదు. మానవ ధృవీకరణ ఇంకా అవసరం.",
    "Hi. How can I help with the current operation?": "హలో. ప్రస్తుత ఆపరేషన్లో నేను ఎలా సహాయపడగలను?",
    "You're welcome.": "మీకు సహాయం అయ్యిన విషయంలో సంతోషం.",
    "Okay. Let me know if you need anything else.": "సరి. ఏదో అంతరిక్తం అవసరమైతే చెప్పండి.",
    "Sure. What would you like me to repeat?": "ఖచ్చితంగా. మీరు ఏమని పునరావృతం చేయాలనుకుంటున్నారు?",
    "I'm showing operational data from authorized Rakshak AI records. What part would you like me to explain?": "నేను అధీకృత Rakshak AI రికార్డుల నుండి ఆపరేషనల్ డేటాను చూపిస్తున్నాను. ఏ భాగాన్ని వివరించాలి?",
    "No previous results to summarize.": "సారాంశం చేయడానికి మునుపటి ఫలితాలు లేవు.",
    "No urgent items right now. Current operation is stable.": "ఇప్పుడు అత్యవసర అంశాలు లేవు. ప్రస్తుత ఆపరేషన్లు స్థిరంగా ఉన్నాయి."
  },
  hi: {
    "I can show operational information but cannot modify RakshakAI data. Use the relevant authorized operational page to perform that action.": "मैं ऑपरेशनल जानकारी दिखा सकता हूँ, लेकिन RakshakAI डेटा बदल नहीं सकता। यह कार्रवाई संबंधित अधिकृत ऑपरेशनल पेज से करें।",
    "I can't provide passwords, tokens, credentials, private URLs, or other protected configuration.": "मैं पासवर्ड, टोकन, क्रेडेंशियल, निजी URL या अन्य सुरक्षित कॉन्फ़िगरेशन प्रदान नहीं कर सकता।",
    "I can only use approved read-only RakshakAI information tools. I cannot bypass safety rules, execute SQL, or write to operational data.": "मैं केवल स्वीकृत read-only RakshakAI सूचना साधनों का उपयोग कर सकता हूँ। सुरक्षा नियमों को दरकिनार करना, SQL चलाना या ऑपरेशनल डेटा बदलना संभव नहीं है।",
    "I couldn't confidently identify the operational request. Try asking about an incident ID, camera, unit, SLA, or tracking session.": "मैं ऑपरेशनल अनुरोध को स्पष्ट रूप से पहचान नहीं पाया। Incident ID, camera, unit, SLA या tracking session के बारे में पूछें।",
    "No matching active incidents were found.": "कोई मेल खाती सक्रिय घटना नहीं मिली।",
    "No current SLA breaches are recorded.": "वर्तमान में कोई SLA उल्लंघन दर्ज नहीं है।",
    "No response units are currently recorded as available.": "वर्तमान में कोई response unit उपलब्ध दर्ज नहीं है।",
    "No matching unhealthy cameras are currently recorded.": "वर्तमान में ध्यान देने योग्य कोई camera दर्ज नहीं है।",
    "This is a candidate association, not an automatic identity claim. Human verification is still required.": "यह केवल candidate association है, स्वचालित पहचान का दावा नहीं। मानव सत्यापन अभी भी आवश्यक है।",
    "Hi. How can I help with the current operation?": "नमस्ते। वर्तमान ऑपरेशन में मैं कैसे मदद कर सकता हूँ?",
    "You're welcome.": "आपका स्वागत है।",
    "Okay. Let me know if you need anything else.": "ठीक है। कुछ और चाहिए तो बताएं।",
    "Sure. What would you like me to repeat?": "ज़रूर। आप क्या दोहराना चाहते हैं?",
    "I'm showing operational data from authorized Rakshak AI records. What part would you like me to explain?": "मैं अधिकृत Rakshak AI रिकॉर्ड से ऑपरेशनल डेटा दिखा रहा हूँ। आप किस भाग को समझाना चाहते हैं?",
    "No previous results to summarize.": "सारांश के लिए कोई पिछला परिणाम नहीं है।",
    "No urgent items right now. Current operation is stable.": "अभी कोई जरूरी आइटम नहीं है। वर्तमान ऑपरेशन स्थिर है।"
  }
};

const lineLabels = {
  te: {
    "Total registered response units": "మొత్తం నమోదైన response units", "Operational": "పనిచేస్తున్న units", "Registry-available": "రిజిస్ట్రీలో అందుబాటులో ఉన్న units", "Busy or committed": "పనిలో లేదా కేటాయించిన units", "Stale or unavailable telemetry": "పాత లేదా అందుబాటులో లేని GPS", "Live dispatch-eligible": "లైవ్ డిస్పాచ్‌కు అర్హమైన units", "Available response units (registry status)": "రిజిస్ట్రీలో అందుబాటులో ఉన్న response units", "All registered response units": "మొత్తం నమోదైన response units", "Busy or committed units": "పనిలో లేదా కేటాయించిన units", "Offline units": "ఆఫ్‌లైన్ units", "Units with stale or unavailable telemetry": "పాత లేదా అందుబాటులో లేని GPS units",
    "Current Operational Summary": "ప్రస్తుత ఆపరేషనల్ సారాంశం", "Matching active incidents": "సరిపోలే యాక్టివ్ ఘటనలు", "Incidents at or beyond SLA breach": "SLA ఉల్లంఘనలో ఉన్న ఘటనలు", "Available response units": "అందుబాటులో ఉన్న response units", "Offline response units": "ఆఫ్‌లైన్ response units", "Cameras needing attention": "శ్రద్ధ అవసరమైన కెమెరాలు", "Authorized officers": "అధీకృత అధికారులు", "Matching investigations": "సరిపోలే దర్యాప్తులు", "Tracking sessions pending review": "సమీక్ష కోసం పెండింగ్‌లో ఉన్న tracking sessions",
    "Severity": "తీవ్రత", "Status": "స్థితి", "Assigned unit": "కేటాయించిన యూనిట్", "Assignment SLA": "కేటాయింపు SLA", "Response SLA": "ప్రతిస్పందన SLA", "Escalation": "ఎస్కలేషన్", "Source Camera": "మూల కెమెరా", "Incident updated": "ఘటన నవీకరణ", "Health": "ఆరోగ్యం", "Location": "స్థానం", "Recorded reason": "నమోదైన కారణం", "Device reachable": "పరికరం అందుబాటులో ఉంది", "Stream connected": "స్ట్రీమ్ కనెక్ట్ అయింది", "Last usable frame": "చివరి ఉపయోగకరమైన ఫ్రేమ్", "Telemetry updated": "టెలిమెట్రీ నవీకరణ", "Station": "స్టేషన్", "Assigned Incident": "కేటాయించిన ఘటన", "Current Location": "ప్రస్తుత స్థానం", "GPS updated": "GPS నవీకరణ", "Officers": "అధికారులు", "Type": "రకం", "Last seen camera": "చివరిగా కనిపించిన కెమెరా", "Time": "సమయం", "Recommended Unit": "సిఫారసు చేసిన యూనిట్", "Distance": "దూరం", "Reason": "కారణం", "Active incidents": "యాక్టివ్ ఘటనలు", "Critical incidents": "CRITICAL ఘటనలు", "Response units": "Response units", "Available response units": "అందుబాటులో ఉన్న response units", "CCTV sources": "CCTV మూలాలు", "Unhealthy cameras": "అనారోగ్య కెమెరాలు", "Active SLA breaches": "యాక్టివ్ SLA ఉల్లంఘనలు", "Investigation": "దర్యాప్తు", "Assigned Officer": "కేటాయించిన అధికారి", "Last Update": "చివరి నవీకరణ", "Evidence Items": "సాక్ష్య అంశాలు"
  },
  hi: {
    "Current Operational Summary": "वर्तमान ऑपरेशनल सारांश", "Matching active incidents": "मेल खाती सक्रिय घटनाएँ", "Incidents at or beyond SLA breach": "SLA उल्लंघन वाली घटनाएँ", "Available response units": "उपलब्ध response units", "Offline response units": "ऑफ़लाइन response units", "Cameras needing attention": "ध्यान देने योग्य camera", "Authorized officers": "अधिकृत अधिकारी", "Matching investigations": "मेल खाती जाँच", "Tracking sessions pending review": "समीक्षा के लिए लंबित tracking sessions",
    "Severity": "गंभीरता", "Status": "स्थिति", "Assigned unit": "निर्धारित यूनिट", "Assignment SLA": "असाइनमेंट SLA", "Response SLA": "प्रतिक्रिया SLA", "Escalation": "एस्केलेशन", "Source Camera": "स्रोत camera", "Incident updated": "घटना अपडेट", "Health": "स्थिति", "Location": "स्थान", "Recorded reason": "दर्ज कारण", "Device reachable": "डिवाइस उपलब्ध", "Stream connected": "स्ट्रीम कनेक्टेड", "Last usable frame": "अंतिम उपयोगी फ्रेम", "Telemetry updated": "टेलीमेट्री अपडेट", "Station": "स्टेशन", "Assigned Incident": "निर्धारित घटना", "Current Location": "वर्तमान स्थान", "GPS updated": "GPS अपडेट", "Officers": "अधिकारी", "Type": "प्रकार", "Last seen camera": "अंतिम बार देखा गया camera", "Time": "समय", "Recommended Unit": "अनुशंसित यूनिट", "Distance": "दूरी", "Reason": "कारण", "Active incidents": "सक्रिय घटनाएँ", "Critical incidents": "CRITICAL घटनाएँ", "Response units": "Response units", "Available response units": "उपलब्ध response units", "CCTV sources": "CCTV स्रोत", "Unhealthy cameras": "अस्वस्थ camera", "Active SLA breaches": "सक्रिय SLA उल्लंघन", "Investigation": "जाँच", "Assigned Officer": "निर्धारित अधिकारी", "Last Update": "अंतिम अपडेट", "Evidence Items": "साक्ष्य आइटम"
  }
};

const officerLabels = {
  te: { "Total officers": "మొత్తం అధికారులు", "Active officers": "యాక్టివ్ అధికారులు", "On-duty officers": "విధుల్లో ఉన్న అధికారులు", "Available officers": "అందుబాటులో ఉన్న అధికారులు", "Matching officers": "సరిపోలే అధికారులు", "Officer details": "అధికారుల వివరాలు" },
  hi: { "Total officers": "कुल अधिकारी", "Active officers": "सक्रिय अधिकारी", "On-duty officers": "ड्यूटी पर अधिकारी", "Available officers": "उपलब्ध अधिकारी", "Matching officers": "मिलते अधिकारी", "Officer details": "अधिकारी विवरण" }
};
const officerMessages = {
  te: {
    "Counts reflect recorded assignments only, not physical presence.": "ఈ లెక్కలు నమోదైన కేటాయింపుల ఆధారంగా మాత్రమే; భౌతిక హాజరును నిర్ధారించవు.",
    "No officers are recorded as assigned to this station. Unassigned accounts are not counted.": "ఈ స్టేషన్‌కు కేటాయించిన అధికారులు నమోదుకాలేదు. కేటాయింపు లేని ఖాతాలను లెక్కించలేదు.",
    "Which police station? Please provide the station name or station ID.": "ఏ పోలీస్ స్టేషన్? స్టేషన్ పేరు లేదా స్టేషన్ ID చెప్పండి.",
    "No matching station was found. Please provide the full station name or station ID.": "సరిపోలే స్టేషన్ కనబడలేదు. పూర్తి స్టేషన్ పేరు లేదా స్టేషన్ ID చెప్పండి.",
    "This station is outside your authorized scope.": "ఈ స్టేషన్ మీ అధీకృత పరిధికి బయట ఉంది.",
    "No matching officers in the authorized roster.": "అధీకృత జాబితాలో సరిపోలే అధికారులు లేరు."
  },
  hi: {
    "Counts reflect recorded assignments only, not physical presence.": "ये गिनतियां केवल दर्ज तैनाती पर आधारित हैं, भौतिक उपस्थिति पर नहीं।",
    "No officers are recorded as assigned to this station. Unassigned accounts are not counted.": "इस स्टेशन में कोई अधिकारी तैनात दर्ज नहीं है। बिना तैनाती वाले खातों को नहीं गिना गया।",
    "Which police station? Please provide the station name or station ID.": "कौन सा पुलिस स्टेशन? स्टेशन का नाम या ID बताएं।",
    "No matching station was found. Please provide the full station name or station ID.": "कोई मिलता स्टेशन नहीं मिला। पूरा स्टेशन नाम या ID बताएं।",
    "This station is outside your authorized scope.": "यह स्टेशन आपके अधिकृत दायरे से बाहर है।",
    "No matching officers in the authorized roster.": "अधिकृत सूची में कोई मिलता अधिकारी नहीं है।"
  }
};

function localizeAnswer(answer, language) {
  if (language === "en") return String(answer || "");
  const table = { ...exact[language], ...officerMessages[language] };
  return String(answer || "").split("\n").map((line) => {
    if (table[line]) return table[line];
    const separator = line.indexOf(":");
    if (separator > 0) {
      const label = line.slice(0, separator), translated = lineLabels[language]?.[label] || officerLabels[language]?.[label];
      if (translated) return `${translated}:${line.slice(separator + 1)}`;
    }
    const heading = lineLabels[language]?.[line.replace(/:$/, "")] || officerLabels[language]?.[line.replace(/:$/, "")];
    if (heading) return `${heading}${line.endsWith(":") ? ":" : ""}`;
    const missing = line.match(/^No (officer|incident|camera|response unit|tracking record|investigation or incident) with ID (.+) was found\.$/);
    if (missing) return language === "te" ? `${missing[2]} IDతో ${missing[1]} రికార్డు కనబడలేదు.` : `${missing[2]} ID वाला ${missing[1]} रिकॉर्ड नहीं मिला।`;
    const timeline = line.match(/^No timeline entries are recorded for (.+)\.$/);
    if (timeline) return language === "te" ? `${timeline[1]} కోసం timeline entries నమోదు కాలేదు.` : `${timeline[1]} के लिए timeline entries दर्ज नहीं हैं।`;
    return line;
  }).join("\n");
}

function responseLanguage(mode, detectedLanguage, priorLanguage = "en") {
  const selected = selectedLanguage(mode);
  if (selected === "auto") {
    // For new conversations (priorLanguage is default "en"), use detected language
    // For existing conversations, preserve the conversation's language
    if (priorLanguage === "en" && detectedLanguage !== "en") {
      return detectedLanguage;
    }
    return ["en", "te", "hi"].includes(priorLanguage) ? priorLanguage : detectedLanguage;
  }
  return selected;
}

module.exports = {
  SUPPORTED_LANGUAGES, selectedLanguage, detectLanguage, normalizeQuery, responseLanguage, localizeAnswer,
  MULTILINGUAL_WRITE_PATTERN, SENSITIVE_REQUEST_PATTERN, INJECTION_PATTERN
};
