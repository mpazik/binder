export type AuctionOptions = {
  epsilon?: number;
  threshold?: number;
};

export type AuctionResult = {
  assignment: Map<number, number>;
  unassignedBidders: number[];
  unassignedItems: number[];
};

const DEFAULT_EPSILON = 0.01;
const DEFAULT_THRESHOLD = 0;

export const auctionMatch = (
  scores: number[][],
  options?: AuctionOptions,
): AuctionResult => {
  const epsilon = options?.epsilon ?? DEFAULT_EPSILON;
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;

  const numBidders = scores.length;
  const numItems = scores[0]?.length ?? 0;

  if (numBidders === 0 || numItems === 0) {
    return {
      assignment: new Map(),
      unassignedBidders: Array.from({ length: numBidders }, (_, i) => i),
      unassignedItems: Array.from({ length: numItems }, (_, i) => i),
    };
  }

  const prices = new Array<number>(numItems).fill(0);
  const bidderToItem = new Map<number, number>();
  const itemToBidder = new Map<number, number>();
  const permanentlyUnassigned = new Set<number>();

  const findBestItems = (
    bidder: number,
  ): {
    bestItem: number;
    bestValue: number;
    secondBestValue: number;
  } | null => {
    const bidderScores = scores[bidder]!;
    let bestItem = -1;
    let bestValue = -Infinity;
    let secondBestValue = -Infinity;

    for (let item = 0; item < numItems; item++) {
      const value = bidderScores[item]! - prices[item]!;
      if (value > bestValue) {
        secondBestValue = bestValue;
        bestValue = value;
        bestItem = item;
      } else if (value > secondBestValue) {
        secondBestValue = value;
      }
    }

    if (bestItem === -1 || bestValue < threshold) return null;

    if (secondBestValue === -Infinity) {
      secondBestValue = threshold;
    }

    return { bestItem, bestValue, secondBestValue };
  };

  const getUnassignedBidders = (): number[] => {
    const unassigned: number[] = [];
    for (let i = 0; i < numBidders; i++) {
      if (!bidderToItem.has(i) && !permanentlyUnassigned.has(i)) {
        unassigned.push(i);
      }
    }
    return unassigned;
  };

  let unassigned = getUnassignedBidders();

  while (unassigned.length > 0) {
    for (const bidder of unassigned) {
      const best = findBestItems(bidder);

      if (!best) {
        permanentlyUnassigned.add(bidder);
        continue;
      }

      const { bestItem, bestValue, secondBestValue } = best;
      const bid = bestValue - secondBestValue + epsilon;

      const previousOwner = itemToBidder.get(bestItem);
      if (previousOwner !== undefined) {
        bidderToItem.delete(previousOwner);
      }

      bidderToItem.set(bidder, bestItem);
      itemToBidder.set(bestItem, bidder);
      prices[bestItem]! += bid;
    }

    unassigned = getUnassignedBidders();
  }

  const assignedItems = new Set(bidderToItem.values());
  const unassignedItems: number[] = [];
  for (let i = 0; i < numItems; i++) {
    if (!assignedItems.has(i)) {
      unassignedItems.push(i);
    }
  }

  return {
    assignment: bidderToItem,
    unassignedBidders: Array.from(permanentlyUnassigned),
    unassignedItems,
  };
};
