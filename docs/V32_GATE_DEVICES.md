# V32 Gate & Device Console

## Purpose
Connect the product to the physical factory gate layer.

### Device model
- Gate name
- Device name
- Device type: FACE / FINGERPRINT / FACE_FINGERPRINT
- Serial number
- Online/offline state
- Last heartbeat
- Firmware
- IP address

### Live flow
Biometric capture → identity lookup → employment status → NOC validation (for temporary cross-mill work) → allow/block → attendance or Red Flag workflow.

### Operational safeguards
- Device heartbeats
- Last-seen monitoring
- Device registration restricted to authorised admin roles
- Gate events retained for audit
- Blocked attempts do not silently disappear; they feed the employer exception/Red Flag workflow.

### Production note
Real device SDK/protocol integration remains hardware-vendor specific. The V32 API establishes the device abstraction and heartbeat layer so vendor adapters can be plugged in without redesigning the application.
