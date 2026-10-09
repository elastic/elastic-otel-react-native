import { getStatus } from '@elastic/otel-react-native';
import { registerRootComponent } from 'expo';

function App() {
  return null;
}

// The launch check in scripts/expo-fixture.mjs reads this line.
async function logStatus() {
  try {
    const status = await getStatus();
    console.log(`EDOT Expo fixture status: ${JSON.stringify(status)}`);
  } catch (error) {
    console.log(`EDOT Expo fixture status error: ${error.message}`);
  }
}

logStatus();
registerRootComponent(App);
