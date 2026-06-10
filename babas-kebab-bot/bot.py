import ollama
import speech_recognition as sr
from elevenlabs import ElevenLabs
from elevenlabs import stream
import requests
import json
import re

# ─────────────────────────────────────────
#  CONFIG
# ─────────────────────────────────────────
ELEVENLABS_API_KEY = "sk_1033b4c04723b0b37544ba839e2b71c8ef4516caba7e3150"
VOICE_ID           = "JBFqnCBsd6RMkjVDRZzb"
MODEL              = "babas-kebab"
RESTAURANT_ID      = "68b89d11933777014e60cf44"
BASE_URL           = "https://calling-ai-d6bfff1a5450.herokuapp.com/api/orders"
MENU_URL           = f"{BASE_URL}/menu/{RESTAURANT_ID}"
ORDER_URL          = f"{BASE_URL}/create/{RESTAURANT_ID}"

# SIP Trunk info (for demo / presentation)
SIP_TRUNK_PROVIDER = "Twilio"
SIP_TRUNK_NUMBER   = "+1 (415) 523-8886"   # US number (demo)
SIP_DOMAIN         = "babas-kebab.pstn.twilio.com"

# ─────────────────────────────────────────
#  GLOBALS
# ─────────────────────────────────────────
client               = ElevenLabs(api_key=ELEVENLABS_API_KEY)
recognizer           = sr.Recognizer()
conversation_history = []
menu_cache           = None


# ─────────────────────────────────────────
#  1. MENU  –  fetch from server
# ─────────────────────────────────────────
def get_menu_from_server():
    global menu_cache
    if menu_cache:
        return menu_cache
    try:
        resp = requests.get(MENU_URL, timeout=10)
        resp.raise_for_status()
        menu_cache = resp.json()
        print(f"\n✅ Menu loaded: {len(menu_cache.get('menu', []))} items\n")
        return menu_cache
    except Exception as e:
        print(f"❌ Could not fetch menu: {e}")
        return None


def find_menu_item(item_name: str):
    """Return menu item dict if found (case-insensitive), else None."""
    menu = get_menu_from_server()
    if not menu:
        return None
    items = menu.get("menu", [])
    for item in items:
        if item_name.lower() in item.get("name", "").lower():
            return item
    return None


def build_menu_summary() -> str:
    """Return a plain-text menu for the system prompt."""
    menu = get_menu_from_server()
    if not menu:
        return "Menu not available."
    lines = []
    for item in menu.get("menu", []):
        avail = "" if item.get("isAvailable", True) else " [UNAVAILABLE]"
        lines.append(f"- {item['name']}: ${item.get('price', 0)}{avail}  (ID: {item.get('_id', '')})")
    return "\n".join(lines) if lines else "No items found."


# ─────────────────────────────────────────
#  2. ORDER  –  send to server
# ─────────────────────────────────────────
def send_order_to_server(order_data: dict):
    try:
        resp = requests.post(ORDER_URL, json=order_data, timeout=10)
        resp.raise_for_status()
        result = resp.json()
        print(f"\n✅ Order sent! Server response: {json.dumps(result, indent=2)}\n")
        return result
    except Exception as e:
        print(f"❌ Could not send order: {e}")
        return None


def parse_and_send_order(conversation: list):
    """
    Ask the LLM to extract order details from conversation history,
    validate each item against the menu, then POST to server.
    """
    menu = get_menu_from_server()
    menu_summary = build_menu_summary()

    extraction_prompt = f"""
Based on the conversation below, extract the order details and return ONLY valid JSON.

Menu available:
{menu_summary}

Return this exact JSON structure (no extra text):
{{
  "customerName": "string",
  "customerPhone": "string or empty",
  "address": "string or empty",
  "orderType": "delivery | pickup | dine-in",
  "items": [
    {{
      "name": "item name",
      "menuItemId": "ID from menu",
      "quantity": 1,
      "price": 0.0,
      "notes": "e.g. sauces, drink choice"
    }}
  ],
  "totalAmount": 0.0
}}

Conversation:
{json.dumps(conversation, indent=2)}
"""

    try:
        response = ollama.chat(
            model=MODEL,
            messages=[{"role": "user", "content": extraction_prompt}]
        )
        raw = response["message"]["content"]

        # Strip markdown code fences if present
        raw = re.sub(r"```json|```", "", raw).strip()
        order_info = json.loads(raw)

        # Build validated items list
        validated_items = []
        for it in order_info.get("items", []):
            menu_item = find_menu_item(it["name"])
            if not menu_item:
                print(f"⚠️  Item not found in menu: {it['name']} — skipped")
                continue
            if not menu_item.get("isAvailable", True):
                print(f"⚠️  Item unavailable: {it['name']} — skipped")
                continue
            validated_items.append({
                "menuItem": menu_item["_id"],
                "name":     menu_item["name"],
                "quantity": it.get("quantity", 1),
                "price":    menu_item.get("price", 0),
                "notes":    it.get("notes", "")
            })

        if not validated_items:
            print("❌ No valid items to send.")
            return None

        # Recalculate total from validated items
        total = sum(i["price"] * i["quantity"] for i in validated_items)

        payload = {
            "restaurant":    RESTAURANT_ID,
            "customerName":  order_info.get("customerName", "Guest"),
            "customerPhone": order_info.get("customerPhone", ""),
            "address":       order_info.get("address", ""),
            "orderType":     order_info.get("orderType", "pickup"),
            "items":         validated_items,
            "totalAmount":   total
        }

        print(f"\n📦 Sending order:\n{json.dumps(payload, indent=2)}\n")
        return send_order_to_server(payload)

    except json.JSONDecodeError as e:
        print(f"❌ Could not parse order JSON: {e}")
        return None
    except Exception as e:
        print(f"❌ Order extraction error: {e}")
        return None


# ─────────────────────────────────────────
#  3. VOICE
# ─────────────────────────────────────────
def speak(text: str):
    print(f"\n🤖 Assistant: {text}\n")
    audio_stream = client.text_to_speech.stream(
        voice_id=VOICE_ID,
        text=text,
        model_id="eleven_multilingual_v2"
    )
    stream(audio_stream)


def listen() -> str | None:
    with sr.Microphone() as source:
        print("🎤 Listening...")
        recognizer.adjust_for_ambient_noise(source, duration=0.5)
        try:
            audio = recognizer.listen(source, timeout=8, phrase_time_limit=15)
            text  = recognizer.recognize_google(audio)
            print(f"👤 You: {text}")
            return text
        except (sr.WaitTimeoutError, sr.UnknownValueError):
            return None


# ─────────────────────────────────────────
#  4. CHAT
# ─────────────────────────────────────────
def chat(user_message: str) -> str:
    conversation_history.append({"role": "user", "content": user_message})
    response = ollama.chat(model=MODEL, messages=conversation_history)
    reply    = response["message"]["content"]
    conversation_history.append({"role": "assistant", "content": reply})
    return reply


def is_order_complete(text: str) -> bool:
    """Detect when the assistant has confirmed the order."""
    keywords = ["order confirmed", "ready in", "will be delivered", "thank you for your order",
                "your order is", "placed your order"]
    return any(kw in text.lower() for kw in keywords)


# ─────────────────────────────────────────
#  5. MAIN
# ─────────────────────────────────────────
def main():
    print("=" * 55)
    print("   BABA'S KEBAB  –  AI Call Center")
    print("=" * 55)
    print(f"📞 SIP Trunk  : {SIP_TRUNK_PROVIDER}")
    print(f"   Phone      : {SIP_TRUNK_NUMBER}")
    print(f"   SIP Domain : {SIP_DOMAIN}")
    print("=" * 55)

    # Load menu before starting
    menu = get_menu_from_server()
    if menu:
        print("📋 Today's Menu:")
        print(build_menu_summary())
        print("=" * 55)

    # Inject live menu into model context
    menu_context = f"""
Today's live menu fetched from server:
{build_menu_summary()}

Always validate orders against this menu.
If an item is marked [UNAVAILABLE], apologise and suggest an alternative.
"""
    conversation_history.append({"role": "system", "content": menu_context})

    print("\nPress Ctrl+C to end the call\n")

    # Start call
    greeting = chat("A customer just called. Greet them and ask for their name.")
    speak(greeting)

    order_sent = False

    while True:
        user_input = listen()

        if not user_input:
            print("(didn't catch that, try again...)")
            continue

        # End call keywords
        if any(w in user_input.lower() for w in ["bye", "goodbye", "thank you bye", "exit", "quit"]):
            farewell = chat("Customer is leaving. Say a warm goodbye.")
            speak(farewell)
            break

        response = chat(user_input)
        speak(response)

        # Auto-send order when confirmed
        if not order_sent and is_order_complete(response):
            print("\n🔄 Order confirmed — sending to server...\n")
            result = parse_and_send_order(conversation_history)
            if result:
                order_sent = True
                print("✅ Order successfully sent to kitchen system!")
            else:
                print("⚠️  Could not send order automatically.")


if __name__ == "__main__":
    main()
