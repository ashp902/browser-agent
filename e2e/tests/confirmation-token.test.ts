
describe('isBrowserActionRequest null-tolerance', () => {
  it('accepts requests whose optional fields arrive as null from JSON', async () => {
    const { isBrowserActionRequest } = await import('../src/shared/action-protocol');
    const frameAction = {
      protocol_version: 1,
      action_id: 'act-9',
      document_id: 'doc-1',
      observed_mutation_epoch: 0,
      tool: 'go_back',
      args: {},
      expected_target: null, // pydantic model_dump emits null for None
      confirmation_token: null,
    };
    expect(isBrowserActionRequest(frameAction)).toBe(true);
    expect(isBrowserActionRequest({ ...frameAction, expected_target: { role: 'button', normalized_name: 'x', tag_name: 'button' } })).toBe(true);
    expect(isBrowserActionRequest({ ...frameAction, args: 'not-an-object' })).toBe(false);
  });
});
