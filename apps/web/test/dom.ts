// Import first in DOM tests: registers happy-dom globals before React/Testing Library load.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: 'http://localhost:4321/' });
}
