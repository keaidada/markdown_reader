/**
 * Enhance tables with resizable columns.
 * Wraps each table in a scrollable container and adds drag handles to th cells.
 * Only the dragged column width changes; other columns stay fixed.
 */
export function enhanceTables(container) {
  const tables = container.querySelectorAll('table');
  tables.forEach((table) => {
    if (table.parentElement.classList.contains('md-reader-table-wrapper')) return;

    // Wrap table in scrollable container
    const wrapper = document.createElement('div');
    wrapper.className = 'md-reader-table-wrapper';
    table.parentNode.insertBefore(wrapper, table);
    wrapper.appendChild(table);

    table.style.display = 'table';

    // Add resize handles to header cells
    const ths = table.querySelectorAll('th');
    ths.forEach((th) => {
      const handle = document.createElement('div');
      handle.className = 'md-reader-col-resize';
      th.appendChild(handle);
      th.style.position = 'relative';

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Snapshot ALL column widths before any resize starts
        if (!table.dataset.resized) {
          const allThs = table.querySelectorAll('th');
          let totalWidth = 0;
          allThs.forEach((t) => {
            const w = t.offsetWidth;
            t.style.width = w + 'px';
            totalWidth += w;
          });
          // Set table to fixed layout with explicit total width
          // so changing one column does NOT affect others
          table.style.tableLayout = 'fixed';
          table.style.width = totalWidth + 'px';
          table.dataset.resized = 'true';
        }

        const startX = e.pageX;
        const startColWidth = th.offsetWidth;
        const startTableWidth = table.offsetWidth;
        handle.classList.add('md-reader-resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMouseMove = (ev) => {
          const diff = ev.pageX - startX;
          const newColWidth = Math.max(40, startColWidth + diff);
          th.style.width = newColWidth + 'px';
          // Adjust total table width so other columns don't shrink
          table.style.width = (startTableWidth + (newColWidth - startColWidth)) + 'px';
        };

        const onMouseUp = () => {
          handle.classList.remove('md-reader-resizing');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    });
  });
}
