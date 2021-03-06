import {
  Consumer,
  entityListChanger,
  ObjectChange,
  objectChanger,
  Provider,
  reduce,
} from "../../connections";
import { map, pipe, wrap } from "../../connections/mappers";
import { itemsReconciliation } from "../items-reconciliation";
import {
  button,
  Component,
  div,
  setupComponent,
  slot,
  span,
  ViewSetup,
} from "../render";

type ItemId = string;
type Item = { id: ItemId; value: string };
type ItemProvider = { id: ItemId; provider: Provider<Item> };

const item: Component<{
  removed: Consumer<ItemId>;
  clicked: Consumer<ItemId>;
  itemProvider: ItemProvider;
}> = ({ itemProvider: { id, provider }, removed, clicked }) => (
  render,
  onClose
) => {
  const renderView = (item?: Item) =>
    render(
      div(
        button(
          {
            onClick: () => clicked(id),
          },
          "update"
        ),
        button(
          {
            onClick: () => removed(id),
          },
          "remove"
        ),
        item
          ? span(`My name is: ${id} and value: ${item.value}`)
          : span(`My name is: ${id}`)
      )
    );

  renderView();
  provider(onClose, renderView);
};

const mainView: ViewSetup<
  {
    onAdd: () => void;
    onItemClick: (id: ItemId) => void;
    onItemRemoved: (id: ItemId) => void;
  },
  { list: ItemProvider[] }
> = ({ onItemClick, onItemRemoved, onAdd }) => ({ list }) =>
  div(
    {
      id: "main",
    },
    button({ onClick: onAdd }, "add item"),
    div(
      { class: "list" },
      ...list.map(({ id, provider }) =>
        slot(
          "item." + id,
          item({
            clicked: onItemClick,
            removed: onItemRemoved,
            itemProvider: { id, provider: provider },
          })
        )
      )
    )
  );

const newIdGenerator = () => {
  let num = 0;
  return () => {
    num += 1;
    return `elem${num}`;
  };
};
const getItemId = (it: Item) => it.id;

const main: Component = () => (render) => {
  const generateId = newIdGenerator();
  const renderMainView = mainView({
    onAdd: () => {
      updateList(["set", { id: generateId(), value: "test" }]);
    },
    onItemClick: (id) => {
      updateList(["chg", id, ["set", "value", new Date().toISOString()]]);
    },
    onItemRemoved: (id) => {
      updateList(["del", id]);
    },
  });

  const updateList = reduce(
    [],
    entityListChanger<Item, ItemId, ObjectChange<Item>>(
      getItemId,
      objectChanger<Item>((it) => it)
    ),
    itemsReconciliation<Item, ItemId>(getItemId)(
      map(pipe(wrap("list"), renderMainView), render)
    )
  );
};

setupComponent(main(), document.body);
