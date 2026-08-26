# AutoBooking

This project automates the non-captcha parts of the NTUH booking flow, including schedule monitoring, form filling, result classification, and success email notifications.

## Booking Rules

The current live booking flow supports a fixed booking start time and a specific target clinic date.

- `BOOKING_START_AT`: do not attempt booking before this ISO-8601 datetime.
- `TARGET_APPOINTMENT_DATE`: only consider the target doctor's clinic row for this date. Supported formats are `M/D` and `YYYY-MM-DD`.
- the monitor keeps retrying while the target doctor/date row is not yet visible or not yet open for booking
- the monitor stops only when booking succeeds or the target clinic row becomes `full`

## Current OCR Scope

The repository includes a native Tesseract OCR integration for offline OCR testing and evaluation.
It is not wired into unattended captcha submission.
When the live booking flow reaches the captcha checkpoint, the app will also run OCR immediately and emit a structured log entry with message `OCR Result` so you can inspect the suggested text and saved artifact paths.
If you set `INTERACTIVE_CAPTCHA=true`, the same booking session will pause in the terminal, show the `OCR Result`, wait for your manual captcha input, and then continue submission without restarting the browser.
If you also set `CAPTCHA_AUTO=true`, the terminal prompt will offer the OCR suggestion as the default value and you can press Enter to accept it, but the final submission still requires that manual confirmation step.
If Playwright browser download is unavailable on your machine, set `BROWSER_EXECUTABLE_PATH` to a local Chrome or Edge executable and the app will launch that browser directly.

## Install Native Tesseract

This repo integrates the native `tesseract` command line program.
Install Tesseract OCR on Windows from the official project and ensure `tesseract.exe` is available on `PATH`, or set `TESSERACT_PATH` in `.env`.

Official project:
- https://github.com/tesseract-ocr/tesseract

Relevant command line shape from the official docs:

```text
tesseract imagename outputbase -l eng --oem 1 --psm 8 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789
```

This project uses `stdout` as the output target when probing OCR.
For the NTUH captcha images in this repo, `TESSERACT_PSM=8` performs better than `7`, and the live captcha path also constrains OCR to uppercase letters and digits to reduce punctuation noise.

## OCR Probe

1. Save a captcha image locally.
2. Configure `.env` values for Tesseract if needed.
3. Run:

```powershell
npm run ocr:probe -- path\to\captcha.png
```

The probe will:
- preprocess the image with `sharp`
- run native Tesseract CLI against the processed image
- log the recognized text and command used

## Validation

```powershell
npm run typecheck
npm test
```