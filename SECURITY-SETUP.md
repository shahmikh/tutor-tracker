# Locking down the database (do these in order)

The rules in `database.rules.json` are tested (44 checks on the Firebase emulator): students only see their own
data, nobody can make themselves a tutor, and strangers see nothing.

## 1. Give the reminder job its own key (do this BEFORE publishing rules)
1. Firebase console -> Project settings -> Service accounts -> **Generate new private key** (downloads a .json file).
2. Cloudflare -> Workers & Pages -> shahmikh-classroom -> Settings -> Variables and secrets -> **Add**,
   type **Secret**, name `FIREBASE_SERVICE_ACCOUNT`, value = the whole contents of that .json file. Deploy.
3. Open https://portal.shahmikh.com/api/send-reminders - it should answer `{"message":"Checked sessions.",...}`.

## 2. Publish the rules
Firebase console -> Realtime Database -> **Rules** -> paste the contents of `database.rules.json` -> **Publish**.

## 3. Check
Log in as you (tutor) and as a student: dashboards, booking, assignments, payments and chat should all still work.
If something breaks, paste the old rules back (Rules tab -> history) and tell me what failed.

Delete the downloaded key file from your computer once it is saved as a Cloudflare secret.
