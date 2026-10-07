#include <SPI.h>
#include <MFRC522.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// =============================================
// KONFIGURASI — ISI SESUAI MILIK ANDA
// =============================================
const char* WIFI_SSID     = "Wokwi-GUEST";
const char* WIFI_PASSWORD = "";
const char* FIREBASE_HOST = "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com";
const char* FIREBASE_AUTH = "YOUR_DATABASE_SECRET";

// =============================================
// PIN DEFINITION
// =============================================
#define SS_PIN     5
#define RST_PIN    17
#define LED_RED    25   // Step: Pilih Stasiun
#define LED_YELLOW 26   // Step: Scan Operator
#define LED_GREEN  27   // Step: Scan Produk
#define BUZZER     14

// Tombol pilih stasiun
#define BTN_ST1    32
#define BTN_ST2    33
#define BTN_ST3    34
#define BTN_ST4    35

// =============================================
// OPERATOR TABLE
// Scan kartu apapun → cek UID di tabel ini
// Jika tidak ada → pakai "Operator Umum"
// Tambahkan UID kartu Anda setelah diketahui dari Serial Monitor
// =============================================
const int OP_COUNT = 2;
const String OP_UIDS[]  = {
  "xxxxxxxx",   // ← ganti dengan UID kartu operator 1 dari Serial Monitor
  "yyyyyyyy"    // ← ganti dengan UID kartu operator 2
};
const String OP_NAMES[] = {
  "Budi Santoso",
  "Siti Rahayu"
};

// =============================================
// STATE MACHINE
// =============================================
enum ScanStep {
  WAIT_STATION,   // Tunggu tombol stasiun ditekan
  WAIT_OPERATOR,  // Tunggu scan kartu operator
  WAIT_PRODUCT    // Tunggu scan kartu produk
};

ScanStep currentStep      = WAIT_STATION;
int      currentStation   = 0;
String   currentStationName = "";
String   currentOperator  = "Operator Demo";
String   lastUID          = "";
unsigned long lastScanTime = 0;

const String STATION_NAMES[] = { "", "Perakitan", "Pengecatan", "Packing", "Pengiriman" };

MFRC522           rfid(SS_PIN, RST_PIN);
LiquidCrystal_I2C lcd(0x27, 16, 2);

// =============================================
// SETUP
// =============================================
void setup() {
  Serial.begin(115200);
  SPI.begin();
  rfid.PCD_Init();

  lcd.init();
  lcd.backlight();

  pinMode(LED_RED,    OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_GREEN,  OUTPUT);
  pinMode(BUZZER,     OUTPUT);

  // Tombol dengan pull-up internal
  pinMode(BTN_ST1, INPUT_PULLUP);
  pinMode(BTN_ST2, INPUT_PULLUP);
  pinMode(BTN_ST3, INPUT_PULLUP);
  pinMode(BTN_ST4, INPUT_PULLUP);

  // Koneksi WiFi
  lcdPrint("Connecting WiFi", "...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int retry = 0;
  while (WiFi.status() != WL_CONNECTED && retry < 20) {
    delay(500);
    Serial.print(".");
    retry++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    beep(1, 200);
    lcdPrint("WiFi Connected!", "SmartFactory");
    Serial.println("\n[WiFi] Connected: " + WiFi.localIP().toString());
  } else {
    lcdPrint("WiFi Gagal!", "Mode Offline");
    Serial.println("\n[WiFi] Gagal terhubung");
  }
  delay(1200);

  setStep(WAIT_STATION);
}

// =============================================
// LOOP
// =============================================
void loop() {
  // ── CEK TOMBOL STASIUN ──
  if (currentStep == WAIT_STATION) {
    int pressed = readStationButton();
    if (pressed > 0) {
      currentStation     = pressed;
      currentStationName = STATION_NAMES[pressed];
      beep(pressed, 80); // Bunyi sesuai nomor stasiun
      lcdPrint("Stasiun " + String(pressed) + ":", currentStationName);
      Serial.println("[BTN] Stasiun dipilih: " + currentStationName);
      delay(800);
      setStep(WAIT_OPERATOR);
      return;
    }
  }

  // ── CEK RFID ──
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;

  // Anti-debounce: abaikan scan dalam 2 detik terakhir
  if (millis() - lastScanTime < 2000) return;
  lastScanTime = millis();

  String uid = getUID();
  Serial.println("[RFID] UID terbaca: " + uid);

  // ── STEP 2: Scan Operator ──
  if (currentStep == WAIT_OPERATOR) {
    // Cari nama operator dari tabel UID
    currentOperator = lookupOperator(uid);
    beep(1, 120);
    lcdPrint("Operator:", currentOperator.substring(0, 16));
    Serial.println("[OP] Operator: " + currentOperator);
    delay(800);
    setStep(WAIT_PRODUCT);
  }

  // ── STEP 3: Scan Produk ──
  else if (currentStep == WAIT_PRODUCT) {
    lcdPrint("Mengirim...", uid.substring(0, 16));
    Serial.println("[PROD] Produk UID: " + uid);

    bool ok = sendToFirebase(uid, currentStation, currentStationName, currentOperator);

    if (ok) {
      beep(1, 400);
      lcdPrint("Berhasil! ✓", currentStationName);
      Serial.println("[FB] Data terkirim!");
    } else {
      beep(3, 150);
      lcdPrint("Gagal kirim!", "Cek Firebase");
      Serial.println("[FB] Gagal kirim!");
    }

    delay(2000);
    currentOperator = "Operator Demo";
    setStep(WAIT_STATION);
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

// =============================================
// BACA TOMBOL STASIUN
// =============================================
int readStationButton() {
  if (digitalRead(BTN_ST1) == LOW) { delay(50); if (digitalRead(BTN_ST1) == LOW) return 1; }
  if (digitalRead(BTN_ST2) == LOW) { delay(50); if (digitalRead(BTN_ST2) == LOW) return 2; }
  if (digitalRead(BTN_ST3) == LOW) { delay(50); if (digitalRead(BTN_ST3) == LOW) return 3; }
  if (digitalRead(BTN_ST4) == LOW) { delay(50); if (digitalRead(BTN_ST4) == LOW) return 4; }
  return 0;
}

// =============================================
// LOOKUP OPERATOR
// =============================================
String lookupOperator(String uid) {
  for (int i = 0; i < OP_COUNT; i++) {
    if (uid == OP_UIDS[i]) return OP_NAMES[i];
  }
  // Jika UID tidak dikenal → tampilkan UID pendek sebagai nama
  return "Operator-" + uid.substring(0, 5);
}

// =============================================
// KIRIM DATA KE FIREBASE
// =============================================
bool sendToFirebase(String rfidUID, int station, String stationName, String operatorName) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[FB] WiFi tidak terkoneksi");
    return false;
  }

  HTTPClient http;
  String url = String(FIREBASE_HOST) + "/scans.json?auth=" + FIREBASE_AUTH;

  StaticJsonDocument<256> doc;
  doc["rfid"]        = rfidUID;
  doc["station"]     = station;
  doc["stationName"] = stationName;
  doc["operator"]    = operatorName;
  doc["timestamp"]   = millis();

  String payload;
  serializeJson(doc, payload);

  Serial.println("[FB] POST: " + payload);

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(payload);
  Serial.println("[FB] HTTP " + String(code));
  http.end();

  return (code == 200 || code == 201);
}

// =============================================
// HELPERS
// =============================================
void setStep(ScanStep step) {
  currentStep = step;
  digitalWrite(LED_RED,    LOW);
  digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_GREEN,  LOW);

  switch (step) {
    case WAIT_STATION:
      digitalWrite(LED_RED, HIGH);
      lcdPrint("Pilih Stasiun:", "Tekan BTN 1-4");
      break;
    case WAIT_OPERATOR:
      digitalWrite(LED_YELLOW, HIGH);
      lcdPrint("Scan Kartu", "OPERATOR");
      break;
    case WAIT_PRODUCT:
      digitalWrite(LED_GREEN, HIGH);
      lcdPrint("Scan Kartu", "PRODUK");
      break;
  }
}

String getUID() {
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
    if (i < rfid.uid.size - 1) uid += "";
  }
  uid.toUpperCase();
  return uid;
}

void lcdPrint(String line1, String line2) {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(line1.substring(0, 16));
  lcd.setCursor(0, 1); lcd.print(line2.substring(0, 16));
}

void beep(int times, int dur) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER, HIGH); delay(dur);
    digitalWrite(BUZZER, LOW);
    if (i < times - 1) delay(80);
  }
}
