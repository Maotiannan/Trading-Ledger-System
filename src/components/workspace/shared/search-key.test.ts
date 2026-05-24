import { submitSearchOnEnter } from './search-key';

function buildKeyEvent(key: string, value = ' PIKIN ', isComposing = false) {
  return {
    key,
    preventDefault: jest.fn(),
    currentTarget: { value },
    nativeEvent: { isComposing },
  } as unknown as React.KeyboardEvent<HTMLInputElement>;
}

describe('submitSearchOnEnter', () => {
  it('submits the current input value and prevents default form behavior on Enter', () => {
    const onSubmit = jest.fn();
    const event = buildKeyEvent('Enter');

    submitSearchOnEnter(event, onSubmit);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(' PIKIN ');
  });

  it('ignores non-Enter keys and IME composing Enter events', () => {
    const onSubmit = jest.fn();
    const letterEvent = buildKeyEvent('P');
    const composingEvent = buildKeyEvent('Enter', '拼音', true);

    submitSearchOnEnter(letterEvent, onSubmit);
    submitSearchOnEnter(composingEvent, onSubmit);

    expect(letterEvent.preventDefault).not.toHaveBeenCalled();
    expect(composingEvent.preventDefault).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
