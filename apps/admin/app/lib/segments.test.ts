import { describe, expect, it, vi } from "vitest";
import {
  MEMBER_PAGE,
  findSegment,
  isSegmentId,
  listSegments,
  membersPage,
  membersQueryDone,
  segmentSize,
  startMembersQuery,
} from "./segments.server";

/** নকল Admin API: উত্তরগুলো পরপর ফেরত দেয় (Error দিলে GraphQL ত্রুটি), আর কী জিজ্ঞেস করা হলো তা রাখে */
const admin = (responses: unknown[]) => {
  const graphql = vi.fn<
    (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>
  >(async () => {
    const next = responses.shift();
    return next instanceof Error
      ? Response.json({ errors: [{ message: next.message }] })
      : Response.json({ data: next });
  });
  return { graphql };
};
const variables = (c: ReturnType<typeof admin>, call: number) =>
  c.graphql.mock.calls[call]?.[1]?.variables;
const gid = (n: number) => `gid://shopify/Segment/${n}`;
const QUERY = "gid://shopify/CustomerSegmentMembersQuery/7";

const segmentsPage = (nodes: Array<[number, string]>, next: string | null) => ({
  segments: {
    nodes: nodes.map(([id, name]) => ({ id: gid(id), name })),
    pageInfo: { hasNextPage: next !== null, endCursor: next },
  },
});

describe("segment list", () => {
  it("reads every page and sorts by name", async () => {
    const client = admin([
      segmentsPage(
        [
          [2, "VIP"],
          [1, "all buyers"],
        ],
        "c1",
      ),
      segmentsPage([[3, "Bangladesh"]], null),
    ]);
    expect(await listSegments(client)).toEqual([
      { id: gid(1), name: "all buyers" },
      { id: gid(3), name: "Bangladesh" },
      { id: gid(2), name: "VIP" },
    ]);
    expect(variables(client, 0)).toEqual({ after: null });
    expect(variables(client, 1)).toEqual({ after: "c1" });
  });

  it("stops after a fixed number of pages", async () => {
    const client = admin(
      Array.from({ length: 6 }, (_, i) => segmentsPage([[i, `S${i}`]], `c${i}`)),
    );
    expect(await listSegments(client)).toHaveLength(4);
    expect(client.graphql).toHaveBeenCalledTimes(4);
  });
});

describe("one segment", () => {
  it("never asks Shopify about something that is not a segment id", async () => {
    const client = admin([]);
    for (const id of [undefined, "", "123", "gid://shopify/Customer/1", `${gid(1)}x`]) {
      expect(isSegmentId(id)).toBe(false);
      expect(await findSegment(client, id)).toBeNull();
    }
    expect(client.graphql).not.toHaveBeenCalled();
  });

  it("finds a segment, or null when it was deleted", async () => {
    const client = admin([{ segment: { id: gid(5), name: "Repeat buyers" } }, { segment: null }]);
    expect(await findSegment(client, gid(5))).toEqual({ id: gid(5), name: "Repeat buyers" });
    expect(await findSegment(client, gid(6))).toBeNull();
    expect(variables(client, 1)).toEqual({ id: gid(6) });
  });

  it("counts members, and shows no number when Shopify cannot count right away", async () => {
    const client = admin([
      { customerSegmentMembers: { totalCount: 42 } },
      new Error("This segment is too complex, use customerSegmentMembersQueryCreate"),
    ]);
    expect(await segmentSize(client, gid(1))).toBe(42);
    expect(await segmentSize(client, gid(2))).toBeNull();
  });
});

describe("member list for sending", () => {
  it("asks Shopify to build the list, or returns null for a deleted segment", async () => {
    const client = admin([
      {
        customerSegmentMembersQueryCreate: {
          customerSegmentMembersQuery: { id: QUERY, done: false },
          userErrors: [],
        },
      },
      {
        customerSegmentMembersQueryCreate: {
          customerSegmentMembersQuery: null,
          userErrors: [{ field: ["input", "segmentId"], message: "Segment does not exist" }],
        },
      },
    ]);
    expect(await startMembersQuery(client, gid(1))).toEqual({ id: QUERY, done: false });
    expect(variables(client, 0)).toEqual({ input: { segmentId: gid(1) } });
    expect(await startMembersQuery(client, gid(2))).toBeNull();
  });

  it("checks whether the list is ready", async () => {
    const client = admin([
      { customerSegmentMembersQuery: { id: QUERY, done: false } },
      { customerSegmentMembersQuery: { id: QUERY, done: true } },
      { customerSegmentMembersQuery: null },
    ]);
    expect(await membersQueryDone(client, QUERY)).toBe(false);
    expect(await membersQueryDone(client, QUERY)).toBe(true);
    await expect(membersQueryDone(client, QUERY)).rejects.toThrow();
  });

  it("reads a page as customer ids and clean emails", async () => {
    const member = (id: string, email: string | null) => ({
      node: {
        id: `gid://shopify/CustomerSegmentMember/${id}`,
        defaultEmailAddress: email === null ? null : { emailAddress: email },
      },
    });
    const client = admin([
      {
        customerSegmentMembers: {
          edges: [member("11", " Rahim@Example.COM "), member("12", null), member("13", "")],
          pageInfo: { hasNextPage: true, endCursor: "p1" },
        },
      },
      {
        customerSegmentMembers: {
          edges: [],
          pageInfo: { hasNextPage: false, endCursor: "p1" },
        },
      },
    ]);
    expect(await membersPage(client, QUERY, null)).toEqual({
      members: [
        { customerId: "11", email: "rahim@example.com" },
        { customerId: "12", email: null },
        { customerId: "13", email: null },
      ],
      next: "p1",
    });
    expect(variables(client, 0)).toEqual({ queryId: QUERY, after: null });
    expect(client.graphql.mock.calls[0]?.[0]).toContain(`first: ${MEMBER_PAGE}`);
    expect(await membersPage(client, QUERY, "p1")).toEqual({ members: [], next: null });
  });
});
