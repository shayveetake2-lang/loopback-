# LoopBack.ai

Local-first relationship tracking with weighted orbit tiers and context-aware icebreakers.

## Run locally

```bash
npm install
npx serve frontend
```

The frontend app uses Firebase Authentication and Firestore directly in the browser.

## Import contacts and capture messages

From the signed-in dashboard, **Import CSV** accepts these columns:

```text
name,avatar_url,last_interaction_date,last_topic,relationship_tier,custom_cadence_days,role,company,location
```

**Capture message** lets you select a contact, paste an important message from Messenger, Snapchat, SMS, or another app, and save it as an interaction in Firestore. On supported phones, **Open share sheet** can share copied text into the workflow. Private inboxes cannot be pulled automatically by a web app.

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