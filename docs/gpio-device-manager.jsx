import { useState } from "react";

// ─── 상수 ───────────────────────────────────────────────────────
const BCM_PINS = [2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27];

const DEVICE_TYPES = {
  irrigation: { label: "관수 릴레이", icon: "💧", color: "#0ea5e9", desc: "채널 수 선택 가능 (8 / 12)" },
  vent:       { label: "개폐기",      icon: "🪟", color: "#10b981", desc: "열기/닫기 고정 2채널" },
  fan:        { label: "유동펜",      icon: "🌀", color: "#f59e0b", desc: "ON/OFF 고정 1채널" },
};

function makeChannels(type, irrCh) {
  if (type === "irrigation") {
    const n = irrCh === "12" ? 12 : 8;
    return Array.from({ length: n }, (_, i) => ({
      id: `ch_${i}`, label: `구역 ${i + 1}`, pin: null, active: true,
    }));
  }
  if (type === "vent") return [
    { id: "ch_0", label: "열기", pin: null, active: true },
    { id: "ch_1", label: "닫기", pin: null, active: true },
  ];
  if (type === "fan") return [
    { id: "ch_0", label: "ON/OFF", pin: null, active: true },
  ];
  return [];
}

let _uid = 1;
function uid() { return `dev_${_uid++}`; }

// ─── 공통 컴포넌트 ───────────────────────────────────────────────
function Toggle({ on, onChange, size = "md" }) {
  const w = size === "sm" ? 32 : 40, h = size === "sm" ? 18 : 22;
  const d = size === "sm" ? 12 : 16, offset = size === "sm" ? 2 : 3;
  return (
    <div onClick={e => { e.stopPropagation(); onChange(!on); }} style={{
      width: w, height: h, borderRadius: h, flexShrink: 0,
      background: on ? "#22c55e" : "#374151",
      cursor: "pointer", position: "relative", transition: "background 0.2s",
    }}>
      <div style={{
        position: "absolute", top: offset,
        left: on ? w - d - offset : offset,
        width: d, height: d, borderRadius: "50%",
        background: "#fff", transition: "left 0.2s",
        boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
      }} />
    </div>
  );
}

function PinSelect({ value, onChange, usedPins = [] }) {
  return (
    <select
      value={value ?? ""}
      onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}
      onClick={e => e.stopPropagation()}
      style={{
        background: "#0d1117", border: `1px solid ${value ? "#374151" : "#1f2937"}`,
        color: value ? "#e5e7eb" : "#4b5563",
        borderRadius: 6, padding: "3px 6px", fontSize: 11, cursor: "pointer",
        outline: "none", minWidth: 90,
      }}
    >
      <option value="">-- 핀 미지정</option>
      {BCM_PINS.map(p => {
        const occupied = usedPins.includes(p) && value !== p;
        return (
          <option key={p} value={p} disabled={occupied}>
            BCM {p}{occupied ? " (사용중)" : ""}
          </option>
        );
      })}
    </select>
  );
}

// ─── 장치 추가 모달 ──────────────────────────────────────────────
function AddDeviceModal({ onAdd, onClose, usedPinCount }) {
  const [type, setType] = useState(null);
  const [irrCh, setIrrCh] = useState("8");
  const [name, setName] = useState("");

  const remaining = BCM_PINS.length - usedPinCount;
  const neededPins = type === "irrigation" ? Number(irrCh) : type === "vent" ? 2 : type === "fan" ? 1 : 0;
  const canAdd = type && name.trim() && neededPins <= remaining;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
      padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: "#0d1117", border: "1px solid #374151",
        borderRadius: 14, padding: 24, maxWidth: 420, width: "100%",
        boxShadow: "0 25px 50px rgba(0,0,0,0.8)",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: "#f9fafb" }}>+ 장치 추가</h3>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "#6b7280",
            fontSize: 18, cursor: "pointer",
          }}>✕</button>
        </div>

        {/* 장치 유형 선택 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8, letterSpacing: 1 }}>장치 유형</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(DEVICE_TYPES).map(([key, meta]) => (
              <div key={key} onClick={() => { setType(key); setName(meta.label); }} style={{
                display: "flex", alignItems: "center", gap: 12,
                border: `2px solid ${type === key ? meta.color : "#1f2937"}`,
                borderRadius: 10, padding: "10px 14px", cursor: "pointer",
                background: type === key ? meta.color + "14" : "#111827",
                transition: "all 0.15s",
              }}>
                <span style={{ fontSize: 22 }}>{meta.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: type === key ? meta.color : "#9ca3af" }}>
                    {meta.label}
                  </div>
                  <div style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>{meta.desc}</div>
                </div>
                {type === key && key === "irrigation" && (
                  <div style={{ display: "flex", gap: 6 }}>
                    {["8", "12"].map(n => (
                      <button key={n} onClick={e => { e.stopPropagation(); setIrrCh(n); }} style={{
                        padding: "3px 10px", borderRadius: 5, fontSize: 11, cursor: "pointer",
                        border: `1px solid ${irrCh === n ? meta.color : "#374151"}`,
                        background: irrCh === n ? meta.color + "22" : "#1f2937",
                        color: irrCh === n ? meta.color : "#6b7280",
                      }}>{n}ch</button>
                    ))}
                  </div>
                )}
                <div style={{
                  width: 18, height: 18, borderRadius: "50%",
                  border: `2px solid ${type === key ? meta.color : "#374151"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {type === key && <div style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color }} />}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 이름 입력 */}
        {type && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6, letterSpacing: 1 }}>장치 이름</div>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="예: A동 관수, 동쪽 개폐기"
              style={{
                width: "100%", background: "#111827", border: "1px solid #374151",
                color: "#f3f4f6", borderRadius: 8, padding: "10px 12px", fontSize: 13,
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
        )}

        {/* GPIO 여유 표시 */}
        {type && (
          <div style={{
            background: neededPins > remaining ? "#2d0a0a" : "#0a1a0a",
            border: `1px solid ${neededPins > remaining ? "#ef444444" : "#22c55e44"}`,
            borderRadius: 8, padding: "8px 12px", marginBottom: 16, fontSize: 11,
          }}>
            <span style={{ color: "#6b7280" }}>필요 GPIO: </span>
            <span style={{ color: neededPins > remaining ? "#ef4444" : "#22c55e", fontWeight: 700 }}>
              {neededPins}핀
            </span>
            <span style={{ color: "#4b5563" }}> / 남은 GPIO: </span>
            <span style={{ color: remaining < 5 ? "#f59e0b" : "#6b7280" }}>{remaining}핀</span>
          </div>
        )}

        <button
          disabled={!canAdd}
          onClick={() => {
            if (!canAdd) return;
            onAdd({
              id: uid(), type, name: name.trim(),
              irrCh: type === "irrigation" ? irrCh : null,
              enabled: true,
              channels: makeChannels(type, irrCh),
            });
            onClose();
          }}
          style={{
            width: "100%", padding: 12, borderRadius: 8, fontSize: 13, fontWeight: 700,
            cursor: canAdd ? "pointer" : "not-allowed",
            background: canAdd ? "#166534" : "#1f2937",
            border: `1px solid ${canAdd ? "#22c55e" : "#374151"}`,
            color: canAdd ? "#4ade80" : "#4b5563",
            transition: "all 0.2s",
          }}
        >
          {canAdd ? "✅ 장치 추가" : type ? "이름을 입력하세요" : "유형을 선택하세요"}
        </button>
      </div>
    </div>
  );
}

// ─── 장치 카드 ──────────────────────────────────────────────────
function DeviceCard({ device, onUpdate, onRemove, allUsedPins }) {
  const [expanded, setExpanded] = useState(true);
  const meta = DEVICE_TYPES[device.type];
  const assignedCount = device.channels.filter(c => c.pin !== null).length;
  const activeCount = device.channels.filter(c => c.active).length;

  function updateChannel(chId, patch) {
    onUpdate({
      ...device,
      channels: device.channels.map(c => c.id === chId ? { ...c, ...patch } : c),
    });
  }

  function usedPinsExcept(chId) {
    return allUsedPins.filter(p =>
      !device.channels.find(c => c.id === chId && c.pin === p)
    );
  }

  return (
    <div style={{
      border: `1px solid ${device.enabled ? meta.color + "55" : "#1f2937"}`,
      borderRadius: 12, overflow: "hidden",
      background: "#0d1117",
      opacity: device.enabled ? 1 : 0.6,
      transition: "all 0.2s",
    }}>
      {/* 카드 헤더 */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 16px", cursor: "pointer",
          background: device.enabled ? meta.color + "12" : "#111827",
          borderBottom: expanded ? `1px solid ${meta.color}22` : "none",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: 20 }}>{meta.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: device.enabled ? meta.color : "#6b7280" }}>
            {device.name}
          </div>
          <div style={{ fontSize: 10, color: "#4b5563", marginTop: 2 }}>
            {meta.label} · {device.channels.length}채널 ·{" "}
            <span style={{ color: assignedCount === device.channels.length ? "#22c55e" : "#f59e0b" }}>
              핀배정 {assignedCount}/{device.channels.length}
            </span>{" "}
            · 활성 {activeCount}
          </div>
        </div>

        {/* 장치 전체 활성화 토글 */}
        <Toggle
          on={device.enabled}
          onChange={v => onUpdate({ ...device, enabled: v })}
          size="sm"
        />

        {/* 삭제 */}
        <button onClick={e => { e.stopPropagation(); onRemove(device.id); }} style={{
          background: "none", border: "1px solid #374151",
          color: "#6b7280", borderRadius: 5, padding: "2px 8px",
          fontSize: 11, cursor: "pointer",
        }}>삭제</button>

        <span style={{ fontSize: 12, color: "#4b5563" }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* 채널 목록 */}
      {expanded && (
        <div style={{ padding: "12px 14px" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 6,
          }}>
            {device.channels.map((ch, i) => (
              <div key={ch.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                background: ch.active && device.enabled ? "#0a0f0a" : "#111827",
                border: `1px solid ${ch.pin ? meta.color + "33" : "#1f2937"}`,
                borderRadius: 8, padding: "7px 10px",
                transition: "all 0.15s",
              }}>
                {/* 채널 번호 */}
                <div style={{
                  width: 22, height: 22, borderRadius: 5, flexShrink: 0,
                  background: meta.color + "22", border: `1px solid ${meta.color}44`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 800, color: meta.color,
                }}>{i + 1}</div>

                {/* 채널 이름 */}
                <span style={{ flex: 1, fontSize: 11, color: ch.active ? "#d1d5db" : "#4b5563", minWidth: 40 }}>
                  {ch.label}
                </span>

                {/* 핀 선택 */}
                <PinSelect
                  value={ch.pin}
                  onChange={p => updateChannel(ch.id, { pin: p })}
                  usedPins={usedPinsExcept(ch.id)}
                />

                {/* 채널 활성화 */}
                <Toggle
                  on={ch.active}
                  onChange={v => updateChannel(ch.id, { active: v })}
                  size="sm"
                />
              </div>
            ))}
          </div>

          {/* 일괄 조작 */}
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <button onClick={() => onUpdate({
              ...device,
              channels: device.channels.map(c => ({ ...c, active: true })),
            })} style={smallBtn}>전체 활성화</button>
            <button onClick={() => onUpdate({
              ...device,
              channels: device.channels.map(c => ({ ...c, active: false })),
            })} style={smallBtn}>전체 비활성화</button>
            <button onClick={() => onUpdate({
              ...device,
              channels: device.channels.map(c => ({ ...c, pin: null })),
            })} style={{ ...smallBtn, color: "#ef4444", borderColor: "#ef444444" }}>핀 초기화</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 메인 ───────────────────────────────────────────────────────
export default function App() {
  const [devices, setDevices] = useState([
    {
      id: uid(), type: "irrigation", name: "A동 관수", irrCh: "8", enabled: true,
      channels: makeChannels("irrigation", "8"),
    },
    {
      id: uid(), type: "vent", name: "동쪽 개폐기", irrCh: null, enabled: true,
      channels: makeChannels("vent"),
    },
  ]);
  const [showModal, setShowModal] = useState(false);
  const [saved, setSaved] = useState(false);

  const allUsedPins = devices.flatMap(d => d.channels.map(c => c.pin).filter(Boolean));
  const uniqueUsed = [...new Set(allUsedPins)];
  const totalChannels = devices.reduce((s, d) => s + d.channels.length, 0);
  const assignedChannels = devices.reduce((s, d) => s + d.channels.filter(c => c.pin).length, 0);
  const conflictPins = allUsedPins.filter((p, i) => allUsedPins.indexOf(p) !== i);

  function updateDevice(dev) {
    setDevices(prev => prev.map(d => d.id === dev.id ? dev : d));
  }

  function removeDevice(id) {
    setDevices(prev => prev.filter(d => d.id !== id));
  }

  function addDevice(dev) {
    setDevices(prev => [...prev, dev]);
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // GPIO summary
  const gpioStatus = BCM_PINS.map(pin => {
    const dev = devices.find(d => d.channels.some(c => c.pin === pin));
    const ch = dev?.channels.find(c => c.pin === pin);
    return { pin, dev, ch };
  });

  return (
    <div style={{
      minHeight: "100vh",
      background: "#080b10",
      color: "#f3f4f6",
      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      padding: "20px 16px",
      boxSizing: "border-box",
    }}>
      {/* 헤더 */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{
              display: "inline-block", background: "#166534",
              color: "#4ade80", fontSize: 9, fontWeight: 800,
              letterSpacing: 3, padding: "2px 10px", borderRadius: 2, marginBottom: 6,
            }}>SMART FARM GPIO</div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#f9fafb", lineHeight: 1.2 }}>
              릴레이 장치 관리자
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#4b5563" }}>
              장치를 자유롭게 추가하고 GPIO 핀을 배정하세요
            </p>
          </div>
          <button onClick={() => setShowModal(true)} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700,
            background: "#0c2d1a", border: "1px solid #22c55e",
            color: "#4ade80", cursor: "pointer",
          }}>
            <span style={{ fontSize: 18 }}>+</span> 장치 추가
          </button>
        </div>
      </div>

      {/* 상태 요약 */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
        gap: 8, marginBottom: 20,
      }}>
        {[
          { label: "장치 수",    value: devices.length,                    color: "#a78bfa" },
          { label: "총 채널",   value: totalChannels,                     color: "#60a5fa" },
          { label: "핀 배정됨", value: `${assignedChannels}/${totalChannels}`, color: assignedChannels === totalChannels ? "#22c55e" : "#f59e0b" },
          { label: "GPIO 사용", value: `${uniqueUsed.length}/26`,          color: "#0ea5e9" },
          { label: "GPIO 여유", value: 26 - uniqueUsed.length,             color: 26 - uniqueUsed.length < 5 ? "#ef4444" : "#6b7280" },
          { label: "핀 충돌",   value: conflictPins.length > 0 ? `⚠️ ${[...new Set(conflictPins)].length}개` : "없음", color: conflictPins.length > 0 ? "#ef4444" : "#22c55e" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            background: "#0d1117", border: "1px solid #1f2937",
            borderRadius: 8, padding: "10px 12px", textAlign: "center",
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: 9, color: "#4b5563", marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* 충돌 경고 */}
      {conflictPins.length > 0 && (
        <div style={{
          background: "#2d0a0a", border: "1px solid #ef444466",
          borderRadius: 8, padding: "10px 14px", marginBottom: 16,
          fontSize: 12, color: "#fca5a5",
        }}>
          ⚠️ GPIO 핀 충돌: BCM {[...new Set(conflictPins)].join(", ")} — 중복 배정된 핀이 있습니다.
        </div>
      )}

      {/* 장치 목록 */}
      {devices.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "60px 20px",
          border: "1px dashed #1f2937", borderRadius: 12, color: "#374151",
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
          <div style={{ fontSize: 14, marginBottom: 6 }}>등록된 장치가 없습니다</div>
          <div style={{ fontSize: 11 }}>상단 "+ 장치 추가" 버튼으로 장치를 추가하세요</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {devices.map(dev => (
            <DeviceCard
              key={dev.id}
              device={dev}
              onUpdate={updateDevice}
              onRemove={removeDevice}
              allUsedPins={allUsedPins}
            />
          ))}
        </div>
      )}

      {/* GPIO 핀 현황 */}
      {devices.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 11, color: "#4b5563", letterSpacing: 1, marginBottom: 10 }}>
            GPIO 핀 배정 현황 (BCM 번호순)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {gpioStatus.map(({ pin, dev, ch }) => {
              const meta = dev ? DEVICE_TYPES[dev.type] : null;
              const conflict = conflictPins.includes(pin);
              return (
                <div key={pin} title={dev ? `${dev.name} — ${ch.label}` : "미사용"} style={{
                  width: 46, padding: "5px 4px",
                  background: conflict ? "#2d0a0a" : dev ? meta.color + "22" : "#0d1117",
                  border: `1px solid ${conflict ? "#ef4444" : dev ? meta.color + "55" : "#1f2937"}`,
                  borderRadius: 7, textAlign: "center", cursor: "default",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: conflict ? "#ef4444" : dev ? meta.color : "#374151" }}>
                    {pin}
                  </div>
                  <div style={{ fontSize: 8, color: "#4b5563", marginTop: 1, lineHeight: 1.2 }}>
                    {conflict ? "⚠️" : dev ? meta.icon : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 저장 */}
      {devices.length > 0 && (
        <button onClick={handleSave} style={{
          marginTop: 20, width: "100%", padding: 13,
          background: saved ? "#0c2d1a" : "#111827",
          border: `1px solid ${saved ? "#22c55e" : "#374151"}`,
          color: saved ? "#4ade80" : "#9ca3af",
          borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
          transition: "all 0.3s",
        }}>
          {saved ? "✅ 저장 완료!" : "💾 설정 저장"}
        </button>
      )}

      {/* 모달 */}
      {showModal && (
        <AddDeviceModal
          onAdd={addDevice}
          onClose={() => setShowModal(false)}
          usedPinCount={uniqueUsed.length}
        />
      )}
    </div>
  );
}

const smallBtn = {
  padding: "4px 10px", borderRadius: 5, fontSize: 10,
  background: "#111827", border: "1px solid #374151",
  color: "#6b7280", cursor: "pointer",
};
