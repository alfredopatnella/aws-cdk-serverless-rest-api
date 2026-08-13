/**
 * A task item as stored in DynamoDB and returned by the API.
 *
 * `id` is the DynamoDB partition key. Every read or write operation
 * addresses an item using this single value, which is why GetItem and
 * DeleteItem can be simple, fast, single-key lookups.
 */
export interface Item {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
}

/** Shape of the JSON body accepted by POST /items. */
export interface CreateItemRequest {
  title: string;
}
