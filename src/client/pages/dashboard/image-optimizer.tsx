import { Navigate } from 'react-router-dom';

export function Component() {
  return <Navigate to='/dashboard/upload/file?purpose=sign' replace />;
}
