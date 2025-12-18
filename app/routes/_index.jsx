import { redirect } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
    const url = new URL(request.url);

    if (url.searchParams.get("shop")) {
        throw redirect(`/app?${url.searchParams.toString()}`);
    }

    return null;
};

export default function Index() {
    return (
        <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.4", padding: "2rem" }}>
            <h1>Welcome to the Discount App</h1>
            <p>This is the landing page. If you are seeing this, ensure you are accessing the app through your Shopify Admin.</p>
        </div>
    );
}
