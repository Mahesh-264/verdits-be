const fs = require('fs');

const file = 'D:\\Verdits\\verdits-be\\controllers\\teamController.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Modify getNextHearings
content = content.replace(
  /const caseScope = getAuthorizedTeamCaseScope\(\{/g,
  `const now = new Date();\r\n    const caseScope = getAuthorizedTeamCaseScope({`
);

content = content.replace(
  /hearingDate: \{ \$exists: true, \$ne: null \},\s*nextHearingDate: null,/g,
  `hearingDate: { $gte: now },\r\n        nextHearingDate: null,`
);

// 2. Modify getMyNextHearings
content = content.replace(
  /\$or: \[\s*\{ hearingDate: \{ \$gte: now \}, nextHearingDate: null \},\s*\{ nextHearingDate: \{ \$gte: now \} \},\s*\{ hearingDate: \{ \$exists: true, \$ne: null \} \},\s*\],/g,
  `hearingDate: { $gte: now },`
);

content = content.replace(
  /const upcomingHearing = activeHearing \|\| fallbackUpcoming \|\| anyHearing \|\| \(legalCase\.nextHearingAt \|\| legalCase\.startingDate \? \{\s*hearingDate: legalCase\.nextHearingAt \|\| legalCase\.startingDate,\s*hearingTime: '',\s*courtName: legalCase\.courtName,\s*\} : null\);\s*return upcomingHearing \? \{ legalCase, upcomingHearing \} : null;/g,
  `const upcomingHearing = activeHearing || fallbackUpcoming || anyHearing || (legalCase.nextHearingAt || legalCase.startingDate ? {\r\n          hearingDate: legalCase.nextHearingAt || legalCase.startingDate,\r\n          hearingTime: '',\r\n          courtName: legalCase.courtName,\r\n        } : null);\r\n        \r\n        if (upcomingHearing && new Date(upcomingHearing.hearingDate) < now) {\r\n          return null;\r\n        }\r\n\r\n        return upcomingHearing ? { legalCase, upcomingHearing } : null;`
);

fs.writeFileSync(file, content);
console.log("Fixed via regex script!");
