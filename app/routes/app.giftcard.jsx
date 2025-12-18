import { useLoaderData } from "react-router";
import {
    Page,
    Layout,
    Card,
    Text,
    Badge,
    BlockStack,
    Button,
    EmptyState,
    Grid,
    Box,
    InlineStack,
} from "@shopify/polaris";
import { DuplicateIcon, ViewIcon, HideIcon } from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
    const { admin } = await authenticate.admin(request);

    const response = await admin.graphql(
        `#graphql
    query GetGiftCards {
      giftCards(first: 20, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            lastCharacters
            balance {
              amount
              currencyCode
            }
            initialValue {
              amount
              currencyCode
            }
            enabled
            createdAt
            customer {
              firstName
              lastName
              email
            }
          }
        }
      }
    }
  `
    );

    const parsedResponse = await response.json();
    return {
        giftCards: parsedResponse.data?.giftCards?.edges || []
    };
};

function GiftCardItem({ node }) {
    const shopify = useAppBridge();
    const [showCode, setShowCode] = useState(false);
    const balance = node.balance;
    const openCode = `•••• •••• •••• ${node.lastCharacters}`;
    const maskedCode = `•••• •••• •••• ••••`;

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(openCode);
        shopify.toast.show("Gift card code copied");
    }, [openCode, shopify]);

    return (
        <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
            <Card>
                <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                        <Text variant="headingLg" as="h2">
                            {balance.amount} {balance.currencyCode}
                        </Text>
                        <Badge tone={node.enabled ? "success" : "critical"}>
                            {node.enabled ? "Active" : "Disabled"}
                        </Badge>
                    </InlineStack>

                    <Box
                        background="bg-surface-secondary"
                        padding="400"
                        borderRadius="200"
                    >
                        <BlockStack gap="200">
                            <Text tone="subdued" variant="bodySm">Gift Card Code</Text>
                            <InlineStack align="space-between" blockAlign="center">
                                <Text variant="headingMd" as="h4" fontWeight="bold">
                                    {showCode ? openCode : maskedCode}
                                </Text>
                                <InlineStack gap="200">
                                    <Button
                                        variant="plain"
                                        icon={showCode ? HideIcon : ViewIcon}
                                        onClick={() => setShowCode(!showCode)}
                                        accessibilityLabel={showCode ? "Hide code" : "View code"}
                                    />
                                    <Button
                                        variant="plain"
                                        icon={DuplicateIcon}
                                        onClick={handleCopy}
                                        accessibilityLabel="Copy code"
                                    />
                                </InlineStack>
                            </InlineStack>
                        </BlockStack>
                    </Box>

                    <BlockStack gap="100">
                        <Text tone="subdued" variant="bodySm">Issued to</Text>
                        <Text variant="bodyMd" fontWeight="semibold">
                            {node.customer
                                ? `${node.customer.firstName} ${node.customer.lastName}`
                                : "No Customer"}
                        </Text>
                        {node.customer?.email && (
                            <Text tone="subdued" variant="bodySm">{node.customer.email}</Text>
                        )}
                    </BlockStack>
                </BlockStack>
            </Card>
        </Grid.Cell>
    );
}

export default function GiftCards() {
    const { giftCards } = useLoaderData();

    return (
        <Page title="Gift Cards" subtitle="View and manage gift cards">
            {giftCards.length === 0 ? (
                <EmptyState
                    heading="No gift cards found"
                    action={{ content: 'Create gift card', url: 'shopify:admin/gift_cards/new' }}
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                    <p>Create gift cards in your Shopify Admin to see them here.</p>
                </EmptyState>
            ) : (
                <Grid>
                    {giftCards.map(({ node }) => (
                        <GiftCardItem key={node.id} node={node} />
                    ))}
                </Grid>
            )}
        </Page>
    );
}
