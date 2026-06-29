import '../../styles/immersive-theme.css';
import { FormProvider } from '../../context/FormContext';
import ImmersiveWizard from './immersive/ImmersiveWizard';

const RoofingApp = () => (
  <FormProvider>
    <ImmersiveWizard />
  </FormProvider>
);

export default RoofingApp;
