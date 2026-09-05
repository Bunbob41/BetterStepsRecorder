# Corporate Standard Operating Procedure

## DOCUMENT METADATA *(Compliance)*

* **SOP Name:** <!-- PARSER_HOOK: INJECT_TITLE -->
* **Document ID:** <!-- PARSER_HOOK: INJECT_DOC_ID -->
* **Version:** 1.0 (Generated)
* **Effective Date:** <!-- PARSER_HOOK: INJECT_TIMESTAMP -->
* **System/Application:** <!-- PARSER_HOOK: INJECT_TARGET_APP -->

---

## 1. CONTEXT *(The Why & Who)*

### 1.1 Purpose

This standard operating procedure defines the sequence of actions captured
during the target process execution, to ensure consistency and compliance
across the organisation.

### 1.2 Scope

* **Includes:** Actions executed within the recorded session.
* **Excludes:** External hardware operations and manual system overrides that
  were not captured.

### 1.3 Roles & Responsibilities

* **Primary Performer:** <!-- PARSER_HOOK: INJECT_USER_ID -->
* **System Environment:** <!-- PARSER_HOOK: INJECT_OS_ENVIRONMENT -->

---

## 2. CONTENT *(The Action Steps)*

### 2.1 Prerequisites

Before starting, ensure you have the credentials and environment configuration
required by the target application.

### 2.2 Step-by-Step Instructions

<!-- PARSER_HOOK: START_DYNAMIC_STEPS_LOOP -->
**{{number_prefix}}{{description}}**

{{image_block}}

<!-- PARSER_HOOK: END_DYNAMIC_STEPS_LOOP -->

### 2.3 System Exceptions

| Event Detected | Default System Behavior |
| :--- | :--- |
| `UI_ELEMENT_NOT_FOUND` | Stop and log the fault; do not continue the procedure |
| `UNEXPECTED_NAV` | Return to the previous screen and repeat the step |

---

## 3. CONSISTENCY *(Standards & Visuals)*

### 3.1 Event Terminology

* **LEFT_CLICK / RIGHT_CLICK / DOUBLECLICK:** mouse button pressed and released.
* **DRAG:** button held while the pointer moves between two points.
* **KEYTEXT:** a value typed into the focused field, recorded per field rather
  than per keystroke.
* **KEYPRESS:** a named key or modifier chord.
* **PASSWORD:** typing occurred in a masked field; the contents were not recorded.

### 3.2 UI Screen Context Mapping

<!-- PARSER_HOOK: START_IMAGE_GALLERY -->
**Step {{number}} - {{window}}**

{{image_block}}

<!-- PARSER_HOOK: END_IMAGE_GALLERY -->

---

## 4. COMPLIANCE *(Quality & Control)*

### 4.1 Security & Privacy

Applied to this recording: <!-- PARSER_HOOK: INJECT_REDACTION_SUMMARY -->

Password fields are suppressed at capture and their contents never written to
disk. Card and national-insurance shaped values typed into ordinary fields are
masked automatically. Any further redaction is the author's responsibility and
is listed above.

### 4.2 Revision History

| Version | Date | Description of Changes | Author |
| :--- | :--- | :--- | :--- |
| 1.0 | <!-- PARSER_HOOK: INJECT_DATE --> | Captured procedure, <!-- PARSER_HOOK: INJECT_STEP_COUNT --> steps | <!-- PARSER_HOOK: INJECT_USER_ID --> |

### 4.3 Approvals & Sign-Offs

* **Authorised Approver Signature:** ___________________________
* **Date:** ___________________________
