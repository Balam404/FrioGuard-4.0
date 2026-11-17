
#include <WiFi.h>
#include <PubSubClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>

#define TEMP_INT 4
#define TEMP_EXT 16
#define PUERTA 27
#define LED_ROJO 18
#define LED_VERDE 5
#define BUZZER 19

const char* servidor="broker.emqx.io";
const int puerto=1883;
const char* canal="frioguard/hackathon2026/demo-a7c39d2b/telemetria";
const float TEMP_MIN=0.0,TEMP_MAX=5.0;
WiFiClient red;
PubSubClient mqtt(red);
OneWire busIn(TEMP_INT),busOut(TEMP_EXT);
DallasTemperature sensorIn(&busIn),sensorOut(&busOut);
unsigned long ultimoPitido=0,ultimoIntentoMQTT=0;

void setup(){
  Serial.begin(115200);
  pinMode(PUERTA,INPUT_PULLUP);
  pinMode(LED_ROJO,OUTPUT);
  pinMode(LED_VERDE,OUTPUT);
  pinMode(BUZZER,OUTPUT);
  digitalWrite(LED_ROJO,LOW);
  digitalWrite(LED_VERDE,LOW);
  noTone(BUZZER);
  sensorIn.begin();sensorOut.begin();
  sensorIn.setResolution(10);sensorOut.setResolution(10);
  WiFi.mode(WIFI_STA);
  WiFi.begin("Wokwi-GUEST","",6);
  mqtt.setServer(servidor,puerto);
  mqtt.setBufferSize(512);
  Serial.println("FRIOGUARD 4.0 INICIADO");
}

void loop(){
  if(WiFi.status()==WL_CONNECTED){
    if(!mqtt.connected() && millis()-ultimoIntentoMQTT>=3000){
      ultimoIntentoMQTT=millis();
      String id="frioguard_esp32_"+String((uint32_t)ESP.getEfuseMac(),HEX);
      if(mqtt.connect(id.c_str())) Serial.println("MQTT CONECTADO");
      else Serial.printf("ERROR MQTT: %d\n",mqtt.state());
    }
    if(mqtt.connected()) mqtt.loop();
  }

  sensorIn.requestTemperatures();sensorOut.requestTemperatures();
  float ti=sensorIn.getTempCByIndex(0),te=sensorOut.getTempCByIndex(0);
  bool okIn=ti!=DEVICE_DISCONNECTED_C,okOut=te!=DEVICE_DISCONNECTED_C;
  bool abierta=digitalRead(PUERTA)==HIGH;
  bool fuera=okIn&&(ti<TEMP_MIN||ti>TEMP_MAX);
  bool alarma=abierta||fuera||!okIn;

  digitalWrite(LED_ROJO,alarma?HIGH:LOW);
  digitalWrite(LED_VERDE,alarma?LOW:HIGH);
  if(alarma){
    if(ultimoPitido==0||millis()-ultimoPitido>=1200){
      tone(BUZZER,1500,220);ultimoPitido=millis();
    }
  }else{noTone(BUZZER);ultimoPitido=0;}

  const char* motivo=!okIn?"sensor_interno":abierta?"puerta_abierta":fuera?"temperatura_fuera_de_rango":"normal";
  Serial.println("\n--------- FRIOGUARD 4.0 ---------");
  if(okIn) Serial.printf("Interior: %.2f C\n",ti);else Serial.println("Interior: SIN LECTURA");
  if(okOut) Serial.printf("Exterior: %.2f C\n",te);else Serial.println("Exterior: SIN LECTURA");
  Serial.printf("Puerta: %s\n",abierta?"ABIERTA":"CERRADA");
  Serial.printf("Estado: %s\n",alarma?"ALERTA":"NORMAL");
  Serial.printf("Motivo: %s\n",motivo);

  String json="{\"proyecto\":\"FrioGuard 4.0\",\"ms\":"+String(millis());
  json+=",\"temperatura_interna\":"+(okIn?String(ti,2):String("null"));
  json+=",\"temperatura_externa\":"+(okOut?String(te,2):String("null"));
  json+=",\"puerta\":\""+String(abierta?"abierta":"cerrada")+"\"";
  json+=",\"alarma\":"+String(alarma?"true":"false");
  json+=",\"motivo\":\""+String(motivo)+"\"}";
  Serial.println("DATOS_JSON: "+json);

  if(mqtt.connected()){
    if(mqtt.publish(canal,json.c_str())) Serial.println("DATOS ENVIADOS POR MQTT");
    else Serial.println("ERROR AL ENVIAR MQTT");
  }else{
    Serial.println("MQTT NO CONECTADO");
    Serial.println(WiFi.status()==WL_CONNECTED?"WiFi: CONECTADO":"WiFi: DESCONECTADO");
    Serial.printf("Estado MQTT: %d\n",mqtt.state());
  }
  delay(700);
}
