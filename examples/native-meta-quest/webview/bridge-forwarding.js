/**
 * Native-to-VDO delivery is a fixed operation. Reliable-control failure is
 * fatal because silently dropping a transaction would make state ambiguous.
 */
export function forwardNativeFrame({ transport, configuration, endpoint }, lane, peerKey, payload) {
  if (lane === "control") {
    const sent = transport?.sendControl(peerKey, payload) === true;
    if (!sent) {
      endpoint.transportDiagnostic(configuration?.generation ?? -1, "error", "unknown", -1);
      transport?.closePeer(peerKey);
    }
    return sent;
  }
  if (lane === "state") return transport?.sendState(peerKey, payload) === true;
  return false;
}
