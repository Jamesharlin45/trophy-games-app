import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

it('smoke: renders a Text', async () => {
    const result = await render(<Text>hello-jest</Text>);
    expect(result.getByText('hello-jest')).toBeTruthy();
});
