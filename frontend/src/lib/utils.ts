export function cn(...classes: (string | undefined | null | false | Record<string, boolean>)[]): string {
  return classes
    .flatMap((classItem) => {
      if (typeof classItem === 'object' && classItem !== null) {
        return Object.entries(classItem)
          .filter((entry): entry is [string, boolean] => entry[1])
          .map(([key]) => key);
      }
      return classItem;
    })
    .filter(Boolean)
    .join(' ');
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}
