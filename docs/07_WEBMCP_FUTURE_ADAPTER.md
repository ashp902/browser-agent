# 07 - WebMCP Future Adapter

Status: FUTURE-SCOPE ARCHITECTURE; DO NOT MAKE MVP DEPEND ON THIS

## 1. Why this document exists

The project is intentionally designed so native website tools can later replace brittle DOM actuation when a site exposes WebMCP capabilities. This document freezes the adapter boundary while explicitly preventing premature implementation against an evolving experimental API.

## 2. Verified current status at freeze date

As of 2026-08-24, Chrome documentation describes WebMCP as a proposed web standard for exposing structured tools to AI agents. Chrome states that this can improve efficiency, reliability, and task completion compared with agents interpreting page controls.

Chrome's documentation says:

- local development is available behind `chrome://flags/#enable-webmcp-testing`;
- the WebMCP origin trial begins with Chrome 149;
- both imperative JavaScript and declarative HTML-form approaches exist;
- WebMCP is primarily designed for local browser workflows with a human in the loop;
- clients/browsers must visit a site to discover its callable tools;
- WebMCP is under active discussion and subject to change.

The current Chrome DevTools Protocol `WebMCP` domain exposes commands/events including:

```text
WebMCP.enable
WebMCP.disable
WebMCP.invokeTool
WebMCP.cancelInvocation
WebMCP.toolsAdded
WebMCP.toolsRemoved
WebMCP.toolInvoked
WebMCP.toolResponded
```

CDP also exposes annotations such as `readOnly`, `untrustedContent`, and `consequential`.

Critically, CDP documentation warns that WebMCP tool output is untrusted and can carry prompt-injection risk.

## 3. Strategic architecture

Eventually the agent should choose the highest-reliability capability source available:

```text
1. Native site tool (WebMCP / explicitly trusted integration)
2. Deterministic semantic DOM action
3. Future layout projection
4. Future vision/computer-use fallback
```

MVP implements item 2 only.

## 4. Capability abstraction

Backend should conceptually reason over a capability catalog:

```py
class Capability:
    name: str
    source: Literal['browser_dom', 'webmcp', 'site_integration']
    description: str
    input_schema: dict
    annotations: CapabilityAnnotations
```

For MVP, capability catalog contains our browser DOM actions only.

Future WebMCP adapter can add page-native tools to the same catalog.

## 5. Do not confuse website MCP server with WebMCP

This project must use precise terms:

- MCP: Model Context Protocol in broader agent/server contexts.
- WebMCP: proposed browser/web standard where a webpage exposes tools to agents through browser-supported web APIs.

A business integration strategy may eventually support both, but the browser extension adapter described here is specifically about WebMCP/page-native capabilities.

## 6. Why not implement WebMCP immediately

Reasons:

1. Standard/API remains experimental and can change.
2. MVP value can be proven with semantic DOM control.
3. Current verified CDP consumption surface would likely pull in `chrome.debugger`, which has significant permission/user-experience implications and is explicitly excluded from MVP.
4. We do not want agent core coupled to one experimental discovery mechanism.

The AI coding agent MUST NOT add `debugger` permission merely to "support WebMCP early."

## 7. Future adapter contract

When WebMCP is approved for implementation, create an extension-side adapter that returns project-native descriptions:

```ts
interface NativePageTool {
  tool_id: string;
  name: string;
  description?: string;
  input_schema: JsonSchema;
  annotations: {
    read_only?: boolean;
    consequential?: boolean;
    untrusted_content?: boolean;
  };
}
```

Invocation:

```ts
interface NativePageToolInvocation {
  tool_id: string;
  input: Record<string, unknown>;
}
```

Output is always treated as untrusted page data.

## 8. Policy integration

Future WebMCP annotations are hints, not sole authorization.

- `consequential=true` -> minimum `REQUIRE_CONFIRMATION`.
- `readOnly=true` can support ALLOW, but site/tool can still be untrusted.
- `untrustedContent=true` reinforces output isolation.

Our policy engine remains authoritative.

## 9. Tool naming collisions

If page native tool name conflicts with browser tool name, model-facing namespace MUST disambiguate, for example:

```text
site.searchProducts
browser.click_element
```

Exact final namespace is an open decision for the WebMCP implementation milestone.

## 10. Observability

Future traces must record:

- capability source;
- tool name;
- input schema version/hash;
- policy annotation;
- invocation status;
- output classification;
- latency;
- whether browser fallback was needed.

This is important for B2B reliability analytics.

## 11. Business-side future integration

A separate B2B product may help businesses expose reliable site tools. That is out of scope for the Chrome-agent MVP repository. Do not add business SDK code to this repository until a project decision creates that component.

## 12. Implementation trigger

WebMCP work starts only after all are true:

- semantic-DOM MVP passes Milestones 1-3;
- current Chrome API/standard surface is re-verified;
- chosen consumption method is documented;
- any new Chrome permission is explicitly approved;
- adapter test site exists;
- policy behavior for native tool annotations is tested.

## 13. References

- Chrome WebMCP documentation: https://developer.chrome.com/docs/ai/webmcp
- CDP WebMCP domain: https://chromedevtools.github.io/devtools-protocol/tot/WebMCP/
