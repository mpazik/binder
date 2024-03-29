import type { View } from "linki-ui";
import { button, dangerousHtml, div } from "linki-ui";

export const renderDocumentChangeModal: View<{
  oldLines: Element[];
  onRevert: () => void;
}> = ({ oldLines, onRevert }) =>
  div(
    div(
      {
        id: "diff-display",
        class: "Popover-message Popover-message--left px-3 py-2 width-full",
      },
      dangerousHtml(oldLines.map((it) => it.innerHTML).join("\n"))
    ),
    div(
      { class: "Box-row p-1" },
      button(
        {
          class: "btn btn-sm m-1 float-right",
          type: "button",
          onClick: onRevert,
        },
        "revert"
      )
    )
  );
