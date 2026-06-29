import { useNavigate } from 'react-router-dom';
import RoofPolygonAIWorkspace from '@/components/roof-polygon-ai/RoofPolygonAIWorkspace';

export default function AdminRoofPolygonAI() {
  const navigate = useNavigate();
  return <RoofPolygonAIWorkspace onClose={() => navigate(-1)} />;
}