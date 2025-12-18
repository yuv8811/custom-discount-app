import { Page, Layout, Card, BlockStack, Text, Box } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return {};
};

export default function Index() {
  return (
    <Page title="Dashboard">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="500">
              <Box>
                <Text as="h2" variant="headingMd">
                  Welcome to the Discount App
                </Text>
              </Box>
              <Box paddingBlockEnd="400">
                <Text as="p" variant="bodyMd">
                  Manage your discounts and gift cards. Use the discount widget on your storefront to test.
                </Text>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
