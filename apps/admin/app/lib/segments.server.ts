import { gql } from "./admin-client.server";
import type { GraphqlClient } from "./tools.server";

/**
 * Shopify-র customer segment (Customers → Segments): ক্যাম্পেইন কাদের কাছে যাবে তা বেছে নেওয়া,
 * আর পাঠানোর সময় সেগমেন্টের গ্রাহকদের তালিকা আনা। Built for Shopify-এর শর্ত (৫.৬.৩ / ৫.৭.১):
 * অনেক গ্রাহককে লক্ষ্য করে এমন যেকোনো কাজে Shopify admin-এ বানানো যেকোনো সেগমেন্ট বেছে নেওয়া যাবে।
 */

export type SegmentOption = { id: string; name: string };
export type SegmentMember = { customerId: string; email: string | null };

const SEGMENT_GID = /^gid:\/\/shopify\/Segment\/\d+$/;
export const isSegmentId = (value: unknown): value is string =>
  typeof value === "string" && SEGMENT_GID.test(value);

/** তালিকায় কতগুলো সেগমেন্ট আসবে (২৫০ করে ৪ পাতা); এর বেশি সেগমেন্ট খুব কম স্টোরে থাকে */
const SEGMENT_PAGES = 4;
/** পাঠানোর সময় এক ধাপে কতজন গ্রাহক (প্রতি জনে ২ পয়েন্ট, তাই এক কোয়েরিতে ~৫০০ পয়েন্ট) */
export const MEMBER_PAGE = 250;

const SEGMENTS = `#graphql
  query AppSegments($after: String) {
    segments(first: 250, after: $after) {
      nodes { id name }
      pageInfo { hasNextPage endCursor }
    }
  }`;

/** স্টোরের সব সেগমেন্ট, নাম অনুযায়ী সাজানো */
export async function listSegments(admin: GraphqlClient): Promise<SegmentOption[]> {
  const all: SegmentOption[] = [];
  let after: string | null = null;
  for (let page = 0; page < SEGMENT_PAGES; page++) {
    const data: {
      segments: {
        nodes: SegmentOption[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await gql(admin, SEGMENTS, { after });
    all.push(...data.segments.nodes.map(({ id, name }) => ({ id, name })));
    if (!data.segments.pageInfo.hasNextPage) break;
    after = data.segments.pageInfo.endCursor;
  }
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

const SEGMENT = `#graphql
  query AppSegment($id: ID!) {
    segment(id: $id) { id name }
  }`;

/** একটা সেগমেন্ট (না থাকলে বা id ভুল হলে null) */
export async function findSegment(
  admin: GraphqlClient,
  id: unknown,
): Promise<SegmentOption | null> {
  if (!isSegmentId(id)) return null;
  const data = await gql<{ segment: SegmentOption | null }>(admin, SEGMENT, { id });
  return data.segment ? { id: data.segment.id, name: data.segment.name } : null;
}

const SEGMENT_SIZE = `#graphql
  query AppSegmentSize($id: ID!) {
    customerSegmentMembers(segmentId: $id, first: 1) { totalCount }
  }`;

/**
 * সেগমেন্টে কতজন গ্রাহক। জটিল সেগমেন্টের হিসাব Shopify শুধু আলাদা কাজ (async) হিসেবে করে;
 * তখন বা অন্য কোনো সমস্যায় null, আর পাতায় সংখ্যাটা দেখানো হয় না।
 */
export async function segmentSize(admin: GraphqlClient, id: string): Promise<number | null> {
  try {
    const data = await gql<{ customerSegmentMembers: { totalCount: number } }>(
      admin,
      SEGMENT_SIZE,
      { id },
    );
    return data.customerSegmentMembers.totalCount;
  } catch {
    return null;
  }
}

const CREATE_MEMBERS_QUERY = `#graphql
  mutation AppSegmentMembersQuery($input: CustomerSegmentMembersQueryInput!) {
    customerSegmentMembersQueryCreate(input: $input) {
      customerSegmentMembersQuery { id done }
      userErrors { field message }
    }
  }`;

/**
 * পাঠানোর শুরুতে সেগমেন্টের গ্রাহকদের একটা তালিকা বানাতে বলা (Shopify-র async কাজ)। এতে সহজ আর জটিল
 * দুই রকম সেগমেন্টই একই পথে চলে, আর পাঠানো চলাকালীন তালিকা বদলায় না।
 * সেগমেন্টটা মুছে ফেলা হলে (বা আর না থাকলে) null।
 */
export async function startMembersQuery(
  admin: GraphqlClient,
  segmentId: string,
): Promise<{ id: string; done: boolean } | null> {
  const data = await gql<{
    customerSegmentMembersQueryCreate: {
      customerSegmentMembersQuery: { id: string; done: boolean } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(admin, CREATE_MEMBERS_QUERY, { input: { segmentId } });
  const result = data.customerSegmentMembersQueryCreate;
  return result.userErrors.length === 0 ? result.customerSegmentMembersQuery : null;
}

const MEMBERS_QUERY_STATUS = `#graphql
  query AppSegmentMembersQueryStatus($id: ID!) {
    customerSegmentMembersQuery(id: $id) { id done }
  }`;

export async function membersQueryDone(admin: GraphqlClient, id: string): Promise<boolean> {
  const data = await gql<{ customerSegmentMembersQuery: { done: boolean } | null }>(
    admin,
    MEMBERS_QUERY_STATUS,
    { id },
  );
  if (!data.customerSegmentMembersQuery) throw new Error("Segment members query not found");
  return data.customerSegmentMembersQuery.done;
}

const MEMBERS = `#graphql
  query AppSegmentMembers($queryId: ID!, $after: String) {
    customerSegmentMembers(queryId: $queryId, first: ${MEMBER_PAGE}, after: $after) {
      edges { node { id defaultEmailAddress { emailAddress } } }
      pageInfo { hasNextPage endCursor }
    }
  }`;

/** তৈরি হয়ে যাওয়া তালিকার এক পাতা: গ্রাহকের সংখ্যা-id আর ইমেইল (ছোট হাতের অক্ষরে) */
export async function membersPage(
  admin: GraphqlClient,
  queryId: string,
  after: string | null,
): Promise<{ members: SegmentMember[]; next: string | null }> {
  const data = await gql<{
    customerSegmentMembers: {
      edges: Array<{ node: { id: string; defaultEmailAddress: { emailAddress: string } | null } }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  }>(admin, MEMBERS, { queryId, after });
  const { edges, pageInfo } = data.customerSegmentMembers;
  return {
    // id দেখতে gid://shopify/CustomerSegmentMember/123: শেষের সংখ্যাটাই গ্রাহকের id
    members: edges.map(({ node }) => ({
      customerId: node.id.split("/").pop() ?? "",
      email: node.defaultEmailAddress?.emailAddress.trim().toLowerCase() || null,
    })),
    next: pageInfo.hasNextPage ? pageInfo.endCursor : null,
  };
}
