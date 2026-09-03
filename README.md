# LoopBack.ai

Local-first relationship tracking with weighted orbit tiers and context-aware icebreakers.

## Run locally

```bash
npm install
npx serve frontend
```

The frontend app uses Firebase Authentication and Firestore directly in the browser.

Sign-in accepts either an account email or a username. New accounts choose a username during registration; the username is stored in the user profile and its lookup document in Firestore.

## Import contacts and capture messages

The app does not create placeholder contacts. Add your own contacts by selecting **Import CSV** from the dashboard. The CSV must include a `name` column; all other columns are optional:

```text
name,avatar_url,last_interaction_date,last_topic,relationship_tier,custom_cadence_days,role,company,location
```

Use `Inner Loop`, `Mid Loop`, or `Outer Loop` for `relationship_tier`. The dashboard calculates drift from the last interaction date and cadence. **All Contacts** shows every imported contact, while **Drift Alerts** shows contacts who are overdue.

From the signed-in dashboard, **Import CSV** accepts these columns:

```text
name,avatar_url,last_interaction_date,last_topic,relationship_tier,custom_cadence_days,role,company,location
```

**Capture message** lets you select a contact, paste an important message from Messenger, Snapchat, SMS, or another app, and save it as an interaction in Firestore. On supported phones, **Open share sheet** can share copied text into the workflow. Private inboxes cannot be pulled automatically by a web app.

## App guide

- **Search users** searches registered LoopBack accounts in `userDirectory`.
- **Write a new message** opens a private Firestore conversation with another registered user.
- **Loop In** opens a contact's relationship context, recent signals, active threads, and suggested icebreaker.
- **Settings** updates your display name and can send a password reset email.
- **Admin panel** lets administrators search accounts, change roles, and send password reset emails.
- **Help & guide** opens the in-app instructions.

## Firebase setup

1. Create a Firebase project.
2. Enable Authentication and Email/Password sign-in.
3. Create a Firestore database.
4. Publish the Firestore rules from this repository with `firebase deploy --only firestore:rules`.

## Deploy to Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting,firestore:rules
```

This project is configured to deploy the static app from `frontend` using Firebase Hosting.