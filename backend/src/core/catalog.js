// Punarnava catalog: the fixed lists that make repairs countable.
// Reference prices, weights and lifespans are demo assumptions, not market data.
// The UI labels them as estimates. Adding a category = adding an entry here.
// Every label is { en, hi, mr, bn, ta }. Translations are machine-drafted: review with native speakers.

export const CAUSES = {
  voltage_surge: { en: 'Voltage surge', hi: 'वोल्टेज उतार-चढ़ाव', mr: 'व्होल्टेज चढ-उतार', bn: 'ভোল্টেজ ওঠানামা', ta: 'வோல்டேஜ் ஏற்ற இறக்கம்' },
  water_ingress: { en: 'Water got inside', hi: 'अंदर पानी गया', mr: 'आत पाणी गेले', bn: 'ভেতরে জল ঢুকেছে', ta: 'உள்ளே தண்ணீர் புகுந்தது' },
  normal_wear: { en: 'Normal wear', hi: 'सामान्य घिसाव', mr: 'नेहमीची झीज', bn: 'সাধারণ ক্ষয়', ta: 'சாதாரண தேய்மானம்' },
  hard_water: { en: 'Hard-water scaling', hi: 'खारे पानी की परत', mr: 'खाऱ्या पाण्याचा थर', bn: 'খর জলের স্তর', ta: 'உப்புத் தண்ணீர் படிவு' },
  heat: { en: 'Heat', hi: 'गर्मी', mr: 'उष्णता', bn: 'গরম', ta: 'அதிக சூடு' },
  dust: { en: 'Dust', hi: 'धूल', mr: 'धूळ', bn: 'ধুলো', ta: 'தூசி' },
  rodent: { en: 'Rodent damage', hi: 'चूहों से नुकसान', mr: 'उंदरांमुळे नुकसान', bn: 'ইঁদুরের ক্ষতি', ta: 'எலி கடித்த சேதம்' },
  physical_damage: { en: 'Physical damage', hi: 'टूट-फूट', mr: 'मोडतोड', bn: 'ভাঙাচোরা', ta: 'உடைப்பு சேதம்' },
  manufacturing_defect: { en: 'Likely manufacturing defect', hi: 'संभावित निर्माण दोष', mr: 'बनवतानाचा दोष असावा', bn: 'সম্ভবত কারখানার ত্রুটি', ta: 'தயாரிப்பிலேயே குறை இருக்கலாம்' },
  user_handling: { en: 'Handling or overload', hi: 'गलत इस्तेमाल / ओवरलोड', mr: 'चुकीचा वापर / ओव्हरलोड', bn: 'ভুল ব্যবহার / ওভারলোড', ta: 'தவறான பயன்பாடு / ஓவர்லோடு' },
  unknown: { en: 'Not sure', hi: 'पता नहीं', mr: 'माहीत नाही', bn: 'জানি না', ta: 'தெரியவில்லை' },
};

export const SEVERITY = {
  repair_in_place: { en: 'Fixed without a new part', hi: 'बिना नए पार्ट के ठीक', mr: 'नवीन पार्टशिवाय दुरुस्त', bn: 'নতুন পার্ট ছাড়াই ঠিক', ta: 'புதிய பார்ட் இல்லாமல் சரியானது' },
  replace_part: { en: 'Part needs replacing', hi: 'पार्ट बदलना होगा', mr: 'पार्ट बदलावा लागेल', bn: 'পার্ট বদলাতে হবে', ta: 'பார்ட் மாற்ற வேண்டும்' },
  unsafe: { en: 'Unsafe to repair', hi: 'मरम्मत असुरक्षित', mr: 'दुरुस्ती धोक्याची', bn: 'মেরামত করা নিরাপদ নয়', ta: 'பழுது பார்ப்பது ஆபத்து' },
};

export const SPARE = {
  brand: { en: 'Yes, from the brand', hi: 'हाँ, कंपनी से', mr: 'हो, कंपनीकडून', bn: 'হ্যাঁ, কোম্পানি থেকে', ta: 'ஆம், கம்பெனியிடமிருந்து' },
  local: { en: 'Yes, local market', hi: 'हाँ, लोकल बाज़ार में', mr: 'हो, स्थानिक बाजारात', bn: 'হ্যাঁ, লোকাল বাজারে', ta: 'ஆம், உள்ளூர் கடையில்' },
  none: { en: 'Not available', hi: 'उपलब्ध नहीं', mr: 'मिळत नाही', bn: 'পাওয়া যায় না', ta: 'கிடைக்கவில்லை' },
};

export const BARRIERS = {
  none: { en: 'Nothing unusual', hi: 'कोई दिक्कत नहीं', mr: 'काही अडचण नाही', bn: 'কোনো সমস্যা নেই', ta: 'எந்தச் சிக்கலும் இல்லை' },
  glued_or_sealed: { en: 'Glued or sealed shut', hi: 'चिपका या सील बंद', mr: 'चिकटवलेले किंवा सील बंद', bn: 'আঠা বা সিল দিয়ে বন্ধ', ta: 'ஒட்டி அல்லது சீல் வைத்து மூடியது' },
  proprietary_part: { en: 'Only brand part fits', hi: 'सिर्फ कंपनी का पार्ट लगता है', mr: 'फक्त कंपनीचा पार्ट बसतो', bn: 'শুধু কোম্পানির পার্ট লাগে', ta: 'கம்பெனி பார்ட் மட்டுமே பொருந்தும்' },
  no_manual: { en: 'No repair information', hi: 'मरम्मत की जानकारी नहीं', mr: 'दुरुस्तीची माहिती नाही', bn: 'মেরামতের তথ্য নেই', ta: 'பழுது பார்க்கும் தகவல் இல்லை' },
};

export const GATES = {
  capacitors_discharged: { en: 'Capacitors discharged', hi: 'कैपेसिटर डिस्चार्ज किए', mr: 'कॅपॅसिटर डिस्चार्ज केले', bn: 'ক্যাপাসিটর ডিসচার্জ করা হয়েছে', ta: 'கெப்பாசிட்டர் டிஸ்சார்ஜ் செய்யப்பட்டது' },
  data_wiped: { en: 'Owner confirmed data wiped', hi: 'मालिक ने डेटा मिटाया', mr: 'मालकाने डेटा पुसला', bn: 'মালিক ডেটা মুছেছেন', ta: 'உரிமையாளர் டேட்டாவை அழித்தார்' },
  battery_removed: { en: 'Battery removed and kept separate', hi: 'बैटरी अलग निकाली', mr: 'बॅटरी काढून वेगळी ठेवली', bn: 'ব্যাটারি খুলে আলাদা রাখা হয়েছে', ta: 'பேட்டரி கழற்றி தனியாக வைக்கப்பட்டது' },
  refrigerant_recovered: { en: 'Refrigerant recovered by a trained technician', hi: 'गैस सुरक्षित निकाली गई', mr: 'प्रशिक्षित मेकॅनिकने गॅस सुरक्षित काढला', bn: 'প্রশিক্ষিত মিস্ত্রি গ্যাস নিরাপদে বের করেছেন', ta: 'பயிற்சி பெற்ற மெக்கானிக் கேஸை பாதுகாப்பாக எடுத்தார்' },
  lead_battery_to_registered: { en: 'Lead-acid battery kept for a registered battery recycler', hi: 'बैटरी पंजीकृत रिसाइक्लर के लिए अलग', mr: 'लेड-ॲसिड बॅटरी नोंदणीकृत रिसायकलरसाठी वेगळी ठेवली', bn: 'লেড-অ্যাসিড ব্যাটারি নথিভুক্ত রিসাইক্লারের জন্য আলাদা রাখা হয়েছে', ta: 'லெட்-ஆசிட் பேட்டரி பதிவு செய்த ரீசைக்ளருக்காக தனியாக வைக்கப்பட்டது' },
  uv_lamp_separated: { en: 'UV lamp (mercury) kept separate', hi: 'यूवी लैंप (पारा) अलग रखा', mr: 'यूव्ही दिवा (पारा) वेगळा ठेवला', bn: 'ইউভি ল্যাম্প (পারদ) আলাদা রাখা হয়েছে', ta: 'யூவி விளக்கு (பாதரசம்) தனியாக வைக்கப்பட்டது' },
};

// c(id, [en, hi, mr, bn, ta], partCost ₹, harvestValue ₹, weightKg, flags)
const c = (id, [en, hi, mr, bn, ta], cost, harvest, kg, flags = {}) => ({ id, en, hi, mr, bn, ta, cost, harvest, kg, ...flags });

// Component names shared across categories.
const N = {
  control_board: ['Control board', 'कंट्रोल बोर्ड', 'कंट्रोल बोर्ड', 'কন্ট্রোল বোর্ড', 'கண்ட்ரோல் போர்டு'],
  motor: ['Motor', 'मोटर', 'मोटर', 'মোটর', 'மோட்டார்'],
  inlet_valve: ['Inlet valve', 'इनलेट वाल्व', 'इनलेट व्हॉल्व्ह', 'ইনলেট ভালভ', 'இன்லெட் வால்வு'],
  capacitor: ['Capacitor', 'कैपेसिटर', 'कॅपॅसिटर', 'ক্যাপাসিটর', 'கெப்பாசிட்டர்'],
  battery: ['Battery', 'बैटरी', 'बॅटरी', 'ব্যাটারি', 'பேட்டரி'],
  display: ['Display', 'डिस्प्ले', 'डिस्प्ले', 'ডিসপ্লে', 'டிஸ்ப்ளே'],
  charging_port: ['Charging port', 'चार्जिंग पोर्ट', 'चार्जिंग पोर्ट', 'চার্জিং পোর্ট', 'சார்ஜிங் போர்ட்'],
  motherboard: ['Motherboard', 'मदरबोर्ड', 'मदरबोर्ड', 'মাদারবোর্ড', 'மதர்போர்டு'],
  compressor: ['Compressor', 'कंप्रेसर', 'कॉम्प्रेसर', 'কম্প্রেসার', 'கம்ப்ரசர்'],
  gas_leak: ['Gas leak in cooling circuit', 'गैस लीक', 'गॅस लीक', 'গ্যাস লিক', 'கேஸ் லீக்'],
  fan_motor: ['Fan motor', 'फैन मोटर', 'फॅन मोटर', 'ফ্যান মোটর', 'ஃபேன் மோட்டார்'],
};

export const CATEGORIES = {
  washing_machine: {
    en: 'Washing machine', hi: 'वॉशिंग मशीन', mr: 'वॉशिंग मशीन', bn: 'ওয়াশিং মেশিন', ta: 'வாஷிங் மெஷின்', icon: 'washer',
    newPrice: 22000, lifespan: 10, labour: 600, kg: 35, scrapRate: 18, warrantyYears: 2,
    gates: ['capacitors_discharged'],
    components: [
      c('control_board', N.control_board, 3200, 900, 0.4, { icon: 'board', modelSpecific: true }),
      c('motor', N.motor, 4200, 1500, 6, { icon: 'motor' }),
      c('drain_pump', ['Drain pump', 'ड्रेन पंप', 'ड्रेन पंप', 'ড্রেন পাম্প', 'டிரெய்ன் பம்ப்'], 1200, 350, 0.6, { icon: 'pump' }),
      c('inlet_valve', N.inlet_valve, 650, 150, 0.2, { icon: 'valve', universal: true }),
      c('drum_bearing', ['Drum bearing', 'ड्रम बेयरिंग', 'ड्रम बेअरिंग', 'ড্রাম বিয়ারিং', 'டிரம் பேரிங்'], 1500, 0, 1, { icon: 'bearing' }),
      c('belt', ['Belt', 'बेल्ट', 'बेल्ट', 'বেল্ট', 'பெல்ட்'], 400, 80, 0.2, { icon: 'belt', universal: true }),
      c('door_lock', ['Door lock', 'डोर लॉक', 'डोअर लॉक', 'ডোর লক', 'டோர் லாக்'], 700, 180, 0.15, { icon: 'lock' }),
      c('pressure_switch', ['Pressure switch', 'प्रेशर स्विच', 'प्रेशर स्विच', 'প্রেসার সুইচ', 'பிரஷர் சுவிட்ச்'], 550, 150, 0.1, { icon: 'switch' }),
      c('capacitor', ['Motor capacitor', 'मोटर कैपेसिटर', 'मोटर कॅपॅसिटर', 'মোটর ক্যাপাসিটর', 'மோட்டார் கெப்பாசிட்டர்'], 250, 0, 0.1, { icon: 'capacitor', hazardous: true }),
    ],
  },
  mixer_grinder: {
    en: 'Mixer-grinder', hi: 'मिक्सर-ग्राइंडर', mr: 'मिक्सर', bn: 'মিক্সার গ্রাইন্ডার', ta: 'மிக்ஸி', icon: 'mixer',
    newPrice: 3500, lifespan: 6, labour: 200, kg: 3.5, scrapRate: 25, warrantyYears: 2,
    gates: [],
    components: [
      c('coupler', ['Coupler', 'कपलर', 'कपलर', 'কাপলার', 'கப்ளர்'], 120, 20, 0.02, { icon: 'gear' }),
      c('motor', ['Motor winding', 'मोटर वाइंडिंग', 'मोटर वाइंडिंग', 'মোটর ওয়াইন্ডিং', 'மோட்டார் வைண்டிங்'], 900, 300, 1.4, { icon: 'motor' }),
      c('jar_blade', ['Jar blade assembly', 'जार ब्लेड', 'जार ब्लेड', 'জার ব্লেড', 'ஜார் பிளேடு'], 450, 120, 0.2, { icon: 'blade' }),
      c('carbon_brush', ['Carbon brush', 'कार्बन ब्रश', 'कार्बन ब्रश', 'কার্বন ব্রাশ', 'கார்பன் பிரஷ்'], 80, 0, 0.01, { icon: 'brush', universal: true }),
      c('switch_knob', ['Speed switch', 'स्पीड स्विच', 'स्पीड स्विच', 'স্পিড সুইচ', 'ஸ்பீடு சுவிட்ச்'], 150, 40, 0.05, { icon: 'switch' }),
      c('overload_protector', ['Overload protector', 'ओवरलोड प्रोटेक्टर', 'ओव्हरलोड प्रोटेक्टर', 'ওভারলোড প্রোটেক্টর', 'ஓவர்லோடு புரொடெக்டர்'], 120, 30, 0.02, { icon: 'shield', universal: true }),
    ],
  },
  ceiling_fan: {
    en: 'Ceiling fan', hi: 'छत का पंखा', mr: 'छताचा पंखा', bn: 'সিলিং ফ্যান', ta: 'சீலிங் ஃபேன்', icon: 'fan',
    newPrice: 2800, lifespan: 12, labour: 200, kg: 5, scrapRate: 30, warrantyYears: 2,
    gates: [],
    components: [
      c('capacitor', N.capacitor, 180, 40, 0.05, { icon: 'capacitor', universal: true }),
      c('winding', ['Winding', 'वाइंडिंग', 'वाइंडिंग', 'ওয়াইন্ডিং', 'வைண்டிங்'], 700, 250, 2, { icon: 'motor' }),
      c('bearing', ['Bearing', 'बेयरिंग', 'बेअरिंग', 'বিয়ারিং', 'பேரிங்'], 250, 0, 0.1, { icon: 'bearing', universal: true }),
      c('regulator', ['Regulator', 'रेगुलेटर', 'रेग्युलेटर', 'রেগুলেটর', 'ரெகுலேட்டர்'], 300, 80, 0.15, { icon: 'switch', universal: true }),
      c('blades', ['Blades', 'ब्लेड', 'पंख्याची पाती', 'পাখার ব্লেড', 'ஃபேன் இறக்கைகள்'], 600, 250, 1.2, { icon: 'blade' }),
      c('canopy', ['Canopy and shackle', 'कैनोपी', 'कॅनोपी आणि कडी', 'ক্যানোপি ও কড়া', 'கேனோபி மற்றும் கொக்கி'], 150, 40, 0.3, { icon: 'shield' }),
    ],
  },
  smartphone: {
    en: 'Smartphone', hi: 'स्मार्टफोन', mr: 'स्मार्टफोन', bn: 'স্মার্টফোন', ta: 'ஸ்மார்ட்போன்', icon: 'phone',
    newPrice: 15000, lifespan: 4, labour: 300, kg: 0.2, scrapRate: 400, warrantyYears: 1,
    gates: ['data_wiped', 'battery_removed'],
    components: [
      c('battery', N.battery, 1500, 0, 0.05, { icon: 'battery', hazardous: true }),
      c('display', N.display, 3500, 1200, 0.05, { icon: 'screen', modelSpecific: true }),
      c('charging_port', N.charging_port, 400, 100, 0.005, { icon: 'port' }),
      c('motherboard', N.motherboard, 5000, 1500, 0.03, { icon: 'board', modelSpecific: true }),
      c('camera', ['Camera', 'कैमरा', 'कॅमेरा', 'ক্যামেরা', 'கேமரா'], 1200, 400, 0.005, { icon: 'camera', modelSpecific: true }),
      c('speaker', ['Speaker', 'स्पीकर', 'स्पीकर', 'স্পিকার', 'ஸ்பீக்கர்'], 300, 80, 0.005, { icon: 'speaker' }),
      c('back_glass', ['Back glass', 'बैक ग्लास', 'मागची काच', 'পেছনের কাচ', 'பின்பக்க கண்ணாடி'], 600, 100, 0.02, { icon: 'screen', modelSpecific: true }),
    ],
  },
  laptop: {
    en: 'Laptop', hi: 'लैपटॉप', mr: 'लॅपटॉप', bn: 'ল্যাপটপ', ta: 'லேப்டாப்', icon: 'laptop',
    newPrice: 50000, lifespan: 6, labour: 800, kg: 2, scrapRate: 250, warrantyYears: 1,
    gates: ['data_wiped', 'battery_removed'],
    components: [
      c('battery', N.battery, 3500, 0, 0.3, { icon: 'battery', hazardous: true }),
      c('display', N.display, 6000, 2000, 0.5, { icon: 'screen', modelSpecific: true }),
      c('motherboard', N.motherboard, 12000, 4000, 0.3, { icon: 'board', modelSpecific: true }),
      c('keyboard', ['Keyboard', 'कीबोर्ड', 'कीबोर्ड', 'কিবোর্ড', 'கீபோர்டு'], 1800, 500, 0.2, { icon: 'keyboard', modelSpecific: true }),
      c('hinge', ['Hinge', 'हिंज', 'हिंज', 'হিঞ্জ', 'ஹிஞ்ச்'], 900, 250, 0.1, { icon: 'hinge' }),
      c('charging_port', N.charging_port, 700, 150, 0.01, { icon: 'port' }),
      c('storage', ['SSD storage', 'एसएसडी स्टोरेज', 'एसएसडी स्टोरेज', 'এসএসডি স্টোরেজ', 'எஸ்எஸ்டி ஸ்டோரேஜ்'], 3000, 1200, 0.01, { icon: 'chip', universal: true }),
    ],
  },
  ro_purifier: {
    en: 'RO water purifier', hi: 'आरओ वॉटर प्यूरीफायर', mr: 'आरओ वॉटर प्युरिफायर', bn: 'আর.ও. ওয়াটার পিউরিফায়ার', ta: 'ஆர்.ஓ. வாட்டர் பியூரிஃபையர்', icon: 'drop',
    newPrice: 14000, lifespan: 7, labour: 400, kg: 9, scrapRate: 15, warrantyYears: 1,
    gates: ['uv_lamp_separated'],
    components: [
      c('membrane', ['RO membrane', 'आरओ मेम्ब्रेन', 'आरओ मेम्ब्रेन', 'আর.ও. মেমব্রেন', 'ஆர்.ஓ. மெம்பிரேன்'], 2200, 0, 0.3, { icon: 'filter', universal: true }),
      c('inlet_valve', ['Solenoid valve', 'सोलेनॉइड वाल्व', 'सोलेनॉइड व्हॉल्व्ह', 'সোলেনয়েড ভালভ', 'சோலனாய்டு வால்வு'], 550, 150, 0.1, { icon: 'valve', universal: true }),
      c('booster_pump', ['Booster pump', 'बूस्टर पंप', 'बूस्टर पंप', 'বুস্টার পাম্প', 'பூஸ்டர் பம்ப்'], 1800, 600, 1.1, { icon: 'pump', universal: true }),
      c('smps', ['Power adapter (SMPS)', 'पावर एडाप्टर (एसएमपीएस)', 'पॉवर अडॅप्टर (एसएमपीएस)', 'পাওয়ার অ্যাডাপ্টার (এসএমপিএস)', 'பவர் அடாப்டர் (எஸ்எம்பிஎஸ்)'], 900, 300, 0.3, { icon: 'chip', universal: true }),
      c('float_switch', ['Float switch', 'फ्लोट स्विच', 'फ्लोट स्विच', 'ফ্লোট সুইচ', 'ஃப்ளோட் சுவிட்ச்'], 250, 60, 0.05, { icon: 'switch', universal: true }),
      c('uv_lamp', ['UV lamp', 'यूवी लैंप', 'यूव्ही दिवा', 'ইউভি ল্যাম্প', 'யூவி விளக்கு'], 900, 0, 0.1, { icon: 'lamp', hazardous: true }),
    ],
  },
  refrigerator: {
    en: 'Refrigerator', hi: 'फ्रिज', mr: 'फ्रीज', bn: 'ফ্রিজ', ta: 'ஃப்ரிட்ஜ்', icon: 'fridge',
    newPrice: 28000, lifespan: 12, labour: 800, kg: 50, scrapRate: 16, warrantyYears: 1,
    gates: ['refrigerant_recovered', 'capacitors_discharged'],
    components: [
      c('compressor', N.compressor, 6500, 2500, 9, { icon: 'motor' }),
      c('relay_olp', ['Relay and overload', 'रिले और ओवरलोड', 'रिले आणि ओव्हरलोड', 'রিলে ও ওভারলোড', 'ரிலே மற்றும் ஓவர்லோடு'], 450, 100, 0.05, { icon: 'switch', universal: true }),
      c('thermostat', ['Thermostat', 'थर्मोस्टेट', 'थर्मोस्टॅट', 'থার্মোস্ট্যাট', 'தெர்மோஸ்டாட்'], 600, 150, 0.1, { icon: 'gauge' }),
      c('cooling_circuit', N.gas_leak, 2500, 0, 0, { icon: 'drop' }),
      c('defrost_heater', ['Defrost heater', 'डीफ्रॉस्ट हीटर', 'डीफ्रॉस्ट हीटर', 'ডিফ্রস্ট হিটার', 'டீஃப்ராஸ்ட் ஹீட்டர்'], 700, 150, 0.2, { icon: 'heat' }),
      c('control_board', N.control_board, 2800, 800, 0.3, { icon: 'board', modelSpecific: true }),
      c('fan_motor', N.fan_motor, 900, 300, 0.4, { icon: 'fan' }),
      c('door_gasket', ['Door gasket', 'डोर गैस्केट', 'दाराचे गॅस्केट', 'দরজার গ্যাসকেট', 'கதவு கேஸ்கெட்'], 900, 0, 0.5, { icon: 'shield' }),
    ],
  },
  air_conditioner: {
    en: 'Air conditioner', hi: 'एयर कंडीशनर', mr: 'एअर कंडिशनर', bn: 'এয়ার কন্ডিশনার', ta: 'ஏசி', icon: 'ac',
    newPrice: 38000, lifespan: 10, labour: 1000, kg: 40, scrapRate: 22, warrantyYears: 1,
    gates: ['refrigerant_recovered', 'capacitors_discharged'],
    components: [
      c('compressor', N.compressor, 9000, 3500, 12, { icon: 'motor' }),
      c('capacitor', N.capacitor, 600, 150, 0.2, { icon: 'capacitor', universal: true }),
      c('pcb', N.control_board, 3500, 1000, 0.3, { icon: 'board', modelSpecific: true }),
      c('fan_motor', N.fan_motor, 2200, 800, 2, { icon: 'fan' }),
      c('cooling_circuit', N.gas_leak, 3000, 0, 0, { icon: 'drop' }),
      c('sensor', ['Temperature sensor', 'तापमान सेंसर', 'तापमान सेन्सर', 'টেম্পারেচার সেন্সর', 'டெம்பரேச்சர் சென்சார்'], 400, 100, 0.02, { icon: 'gauge', universal: true }),
    ],
  },
  inverter: {
    en: 'Home inverter', hi: 'इन्वर्टर', mr: 'इन्व्हर्टर', bn: 'ইনভার্টার', ta: 'இன்வெர்ட்டர்', icon: 'bolt',
    newPrice: 9000, lifespan: 8, labour: 500, kg: 12, scrapRate: 40, warrantyYears: 2,
    gates: ['lead_battery_to_registered', 'capacitors_discharged'],
    components: [
      c('battery', ['Lead-acid battery', 'लेड-एसिड बैटरी', 'लेड-ॲसिड बॅटरी', 'লেড-অ্যাসিড ব্যাটারি', 'லெட்-ஆசிட் பேட்டரி'], 11000, 0, 28, { icon: 'battery', hazardous: true }),
      c('pcb', N.control_board, 2500, 800, 0.4, { icon: 'board', modelSpecific: true }),
      c('transformer', ['Transformer', 'ट्रांसफॉर्मर', 'ट्रान्सफॉर्मर', 'ট্রান্সফরমার', 'டிரான்ஸ்ஃபார்மர்'], 3000, 1200, 6, { icon: 'coil' }),
      c('mosfet_bank', ['MOSFET bank', 'मॉसफेट बैंक', 'मॉसफेट बँक', 'মসফেট ব্যাংক', 'மாஸ்ஃபெட் பேங்க்'], 900, 200, 0.2, { icon: 'chip' }),
      c('cooling_fan', ['Cooling fan', 'कूलिंग फैन', 'कूलिंग फॅन', 'কুলিং ফ্যান', 'கூலிங் ஃபேன்'], 300, 80, 0.1, { icon: 'fan', universal: true }),
      c('display_panel', ['Display panel', 'डिस्प्ले पैनल', 'डिस्प्ले पॅनल', 'ডিসপ্লে প্যানেল', 'டிஸ்ப்ளே பேனல்'], 400, 100, 0.1, { icon: 'screen' }),
    ],
  },
};

// Fictional brands. Tier scales reference prices.
export const BRANDS = {
  'Brand X': { tier: 1.0, models: { washing_machine: ['WM-7', 'WM-9'], mixer_grinder: ['MG-500'], refrigerator: ['RF-240'] } },
  'Brand Y': { tier: 1.3, models: { ro_purifier: ['RO-6', 'RO-8'], ceiling_fan: ['CF-48'], air_conditioner: ['AC-15'] } },
  'Brand Z': { tier: 0.8, models: { mixer_grinder: ['MG-750'], smartphone: ['PH-A1', 'PH-A5'], laptop: ['LP-14'] } },
  'Brand Q': { tier: 1.0, models: { inverter: ['IN-900'], ceiling_fan: ['CF-36'], washing_machine: ['WM-6'] } },
};

// Pincode areas (first three digits) used for regional patterns and nearby search.
// name is { en, hi, mr, bn, ta }; areaName() gives the English string, areaLabel() the object.
const city = (en, hi, mr, bn, ta) => ({ en, hi, mr, bn, ta });
export const AREAS = {
  '110': { name: city('New Delhi', 'नई दिल्ली', 'नवी दिल्ली', 'নয়াদিল্লি', 'புது தில்லி'), tags: ['hot', 'voltage'] },
  '226': { name: city('Lucknow', 'लखनऊ', 'लखनौ', 'লখনউ', 'லக்னோ'), tags: ['hot', 'voltage'] },
  '282': { name: city('Agra', 'आगरा', 'आग्रा', 'আগ্রা', 'ஆக்ரா'), tags: ['hot', 'hard_water', 'voltage'] },
  '302': { name: city('Jaipur', 'जयपुर', 'जयपूर', 'জয়পুর', 'ஜெய்ப்பூர்'), tags: ['hot', 'hard_water'] },
  '342': { name: city('Jodhpur', 'जोधपुर', 'जोधपूर', 'যোধপুর', 'ஜோத்பூர்'), tags: ['hot', 'hard_water'] },
  '380': { name: city('Ahmedabad', 'अहमदाबाद', 'अहमदाबाद', 'আহমেদাবাদ', 'அகமதாபாத்'), tags: ['hot', 'hard_water'] },
  '400': { name: city('Mumbai', 'मुंबई', 'मुंबई', 'মুম্বাই', 'மும்பை'), tags: ['humid'] },
  '411': { name: city('Pune', 'पुणे', 'पुणे', 'পুনে', 'புனே'), tags: [] },
  '500': { name: city('Hyderabad', 'हैदराबाद', 'हैदराबाद', 'হায়দরাবাদ', 'ஹைதராபாத்'), tags: ['hot'] },
  '560': { name: city('Bengaluru', 'बेंगलुरु', 'बंगळुरू', 'বেঙ্গালুরু', 'பெங்களூரு'), tags: [] },
  '600': { name: city('Chennai', 'चेन्नई', 'चेन्नई', 'চেন্নাই', 'சென்னை'), tags: ['humid', 'hot'] },
  '700': { name: city('Kolkata', 'कोलकाता', 'कोलकाता', 'কলকাতা', 'கொல்கத்தா'), tags: ['humid', 'voltage'] },
  '800': { name: city('Patna', 'पटना', 'पाटणा', 'পাটনা', 'பாட்னா'), tags: ['voltage', 'hot'] },
};


export const MIN_SAMPLE = 20;

export function areaOf(pincode) {
  const p = String(pincode || '').replace(/\D/g, '').slice(0, 3);
  return p.length === 3 ? p : '';
}
// English only: used in server-side text, logs and tests.
export function areaName(area) {
  return areaLabel(area).en;
}
export function areaLabel(area) {
  const a = AREAS[area];
  if (a) return a.name;
  if (!area) return { en: 'Unknown area', hi: 'इलाका पता नहीं', mr: 'भाग माहीत नाही', bn: 'এলাকা জানা নেই', ta: 'பகுதி தெரியவில்லை' };
  const x = `${area}xxx`;
  return { en: `Area ${x}`, hi: `इलाका ${x}`, mr: `भाग ${x}`, bn: `এলাকা ${x}`, ta: `பகுதி ${x}` };
}
export function category(id) {
  const cat = CATEGORIES[id];
  if (!cat) throw httpError(400, `Unknown product category: ${id}`, 'unknownCategory', { id });
  return cat;
}
export function component(catId, compId) {
  const comp = category(catId).components.find((x) => x.id === compId);
  if (!comp) throw httpError(400, `Unknown component "${compId}" for ${catId}`, 'unknownComponent', { id: compId, cat: catId });
  return comp;
}
export function brandTier(brand) {
  return BRANDS[brand]?.tier ?? 1.0;
}
export function ageBand(years) {
  const y = Number(years);
  if (!(y >= 0)) return 'unknown';
  if (y < 1) return '0-1';
  if (y < 2) return '1-2';
  if (y < 3) return '2-3';
  if (y < 5) return '3-5';
  return '5+';
}
export const AGE_BANDS = ['0-1', '1-2', '2-3', '3-5', '5+'];
export const AGE_BAND_MID = { '0-1': 0.5, '1-2': 1.5, '2-3': 2.5, '3-5': 4, '5+': 6.5 };

// Is a harvested part (from sourceBrand/sourceModel) usable in brand/model?
export function compatibility(part, brand, model) {
  if (part.brand === brand && part.model === model) return 'exact';
  const comp = CATEGORIES[part.category]?.components.find((x) => x.id === part.component);
  if (!comp) return null;
  if (comp.universal) return 'universal';
  if (part.brand === brand && !comp.modelSpecific) return 'family';
  return null;
}

export function publicCatalog(extraModels = []) {
  const brands = JSON.parse(JSON.stringify(BRANDS));
  for (const m of extraModels) {
    brands[m.brand] ??= { tier: 1.0, models: {} };
    brands[m.brand].models[m.category] ??= [];
    if (!brands[m.brand].models[m.category].includes(m.model)) brands[m.brand].models[m.category].push(m.model);
  }
  return { categories: CATEGORIES, causes: CAUSES, severity: SEVERITY, spare: SPARE, barriers: BARRIERS, gates: GATES, brands, areas: AREAS, minSample: MIN_SAMPLE };
}

// message is the English fallback; code + params let the client translate (err.<code>).
export function httpError(status, message, code, params) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  e.params = params;
  return e;
}
