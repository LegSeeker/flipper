import { Page, PageHeader } from '@/components/layout/PageHeader';
import { ButtonLink } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/card';

export default function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <Page>
        <Card>
          <EmptyState
            title="Nothing here"
            description="The page you're looking for doesn't exist."
            action={
              <ButtonLink to="/" variant="primary">
                Go to dashboard
              </ButtonLink>
            }
          />
        </Card>
      </Page>
    </>
  );
}
