# Video Downloader Actor - Agent Instructions

## Project Overview
Apify Actor להורדת סרטונים מפלטפורמות שונות עם תמיכה בעוגיות לאימות והעלאה ל-Google Drive.

## Development Commands
- התקנת תלויות: `npm install`
- הרצה מקומית: `apify run`
- העלאה ל-Apify: `apify push`

## Key Files
- `src/main.js` - הקוד הראשי של ה-Actor
- `.actor/input_schema.json` - סכמת הקלט
- `.actor/actor.json` - קונפיגורציה של ה-Actor
- `Dockerfile` - הגדרות המכל (container)

## Important Notes
- ה-Actor משתמש ב-yt-dlp להורדת סרטונים
- צריך ffmpeg ו-pip3 מותקנים במערכת
- עוגיות צריכות להיות בפורמט Netscape
- הלוגים מופיעים בצורה מפורטת עם אמוג'ים
- העלאה ל-Google Drive דורשת credentials ידניים (Client ID, Client Secret, Refresh Token)
- העלאה ל-Google Drive משתמשת ב-Python script דינמי שנוצר בזמן ריצה
