import RustImageOptimizer from '@/components/RustImageOptimizer';
import { useTitle } from '@/lib/client/hooks/useTitle';
import { Anchor, Container } from '@mantine/core';
import { Link } from 'react-router-dom';

export function Component() {
  useTitle('Rust Image Optimizer');

  return (
    <Container size='sm' py='md'>
      <Anchor component={Link} to='/auth/image-guide'>
        Rust image dimensions
      </Anchor>
      <RustImageOptimizer />
    </Container>
  );
}
