# Build the real APK from your phone

This package is now a real native Android project plus Codemagic configuration.

## What you need
- An Android phone
- A free GitHub account
- A Codemagic account

## 1. Put this project on GitHub
Create a new repository on GitHub and upload the contents of this ZIP. Keep `codemagic.yaml` at the repository root.

## 2. Open Codemagic
Go to https://codemagic.io/ and sign in with GitHub.
Add the GitHub repository.
Codemagic supports native Android builds and can use a `codemagic.yaml` file in the repository root.

## 3. Start the build
Select the `android-debug` workflow and start a build.

## 4. Get the APK
When the build succeeds, Codemagic exposes the APK as a build artifact:
`android/app/build/outputs/apk/debug/app-debug.apk`

Download that APK to the Android phone and install it.

## Important
This first APK is a visual/mobile prototype wrapper. It launches the current Mannat mobile onboarding screen locally inside the Android app. The Node backend is still separate and is not bundled into the APK.

The next iteration can connect the Android app to a hosted backend and then the login, Worker 360°, attendance, Fatak, Hamal, finance and Red Flag workflows can become fully live.
