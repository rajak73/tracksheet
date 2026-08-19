import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";

/**
 * The activity taxonomy is global (not tenant-scoped), so every authenticated
 * role reads the same list. Behavioural flags are returned alongside each code
 * so callers branch on capability rather than on the code string.
 */
export const GET = withAuth(async () => {
  const activityTypes = await prisma.activityType.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      label: true,
      description: true,
      sortOrder: true,
      isSystem: true,
      isOncePerDay: true,
      isDerivedFromWorkingHours: true,
      countsAsProductive: true,
      isUnutilized: true,
      // The deliverables under each category. Returned here rather than from a
      // second endpoint so a caller cannot hold a category list and a
      // deliverable list that disagree about which belongs to which.
      deliverableTypes: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        // `isCountable` travels with the option so the sheet knows, the moment
        // somebody corrects a row's deliverable, whether a quantity still means
        // anything for it.
        select: { code: true, label: true, isCountable: true },
      },
    },
  });
  return NextResponse.json({
    activityTypes: activityTypes.map(({ deliverableTypes, ...rest }) => ({
      ...rest,
      deliverables: deliverableTypes,
    })),
  });
});
