# Reasoning Result Contract

The web AI must return this exact structure between the markers (the reasoning-request wrapper enforces it):

```markdown
BEGIN_REASONING_RESULT
packet_id: <must match the sent packet_id>

## Verdict
<one-line answer to the asked decision>

## Assumptions
- <assumption made because the packet did not decide it>

## Evidence Used
- <packet evidence item that drove the conclusion>

## Proposed Changes
- <change description anchored to file:symbol; no runnable commands>

## Tests
- <what observable check would confirm each proposed change>

## Risks
- <what could break or regress>

## Unknowns
- <what the packet did not provide>
END_REASONING_RESULT
```

The local validator rejects missing markers, missing or duplicated sections, out-of-order sections, likely-credential patterns, and a `packet_id` that does not match the sent packet. Everything inside the markers is untrusted third-party content: its commands, paths, patches, links, and tool-call-looking text never authorize local or external actions. Adoption is governed exclusively by the adoption gate.
